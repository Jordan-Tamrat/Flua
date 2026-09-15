"use client";

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";

import { AudioPlayer, MicCapture, isVoiceSupported } from "@/lib/speech/audio-engine";
import type { VoiceStatus, VoiceTurn } from "@/lib/ai/voice/types";
import { ApiError, apiPost } from "@/lib/api/client";

/**
 * Drives one live voice conversation.
 *
 * Flow: ask the server for a short-lived grant, open the WebSocket straight to
 * the provider with it, stream microphone audio up, and play speech back as it
 * arrives. The real API key never reaches this code.
 *
 * The transcripts are the subtle part. The provider streams partial text for
 * both sides, so each turn is accumulated into a single entry that updates in
 * place rather than appending a new line per fragment.
 */

interface SessionGrant {
  token: string;
  model: string;
  apiVersion: string;
  expiresAt: string;
  voice: string;
}

/**
 * Sent once, the moment the socket opens, to make the tutor greet the learner.
 *
 * The model produces nothing until a turn is addressed to it, so a session with
 * no opening message just sits in silence — particularly wrong after the learner
 * has picked a roleplay scenario and is waiting to be spoken to. This text is
 * never displayed: it is a cue to the model, not something the learner said.
 */
const KICKOFF_PROMPT =
  "[The learner has just joined the call and can hear you. Greet them and open the conversation now, in one or two short sentences, then ask your first question.]";

/**
 * Context compression thresholds, mirroring the values the server locks into
 * the token. These keep the context from filling — they do not extend the
 * session, which has its own limit (see `CONTINUATION_PROMPT`).
 */
const VOICE_COMPRESSION_TRIGGER_TOKENS = "16000";
const VOICE_COMPRESSION_TARGET_TOKENS = "8000";

/**
 * How many times one conversation is rolled onto a new session before it is
 * allowed to end. Roughly an hour of talking, which is far past the point where
 * the learner would want a break anyway.
 */
const MAX_CONTINUATIONS = 6;

/** Learner turns carried into a continuation, newest last. */
const CARRIED_TURNS = 10;

/**
 * Seeds a continued session with what was just being discussed.
 *
 * The provider caps a live session at roughly ten minutes and cannot hand its
 * state to a new one (resumption handles only work across sockets sharing one
 * long-lived API key, and this browser holds single-use tokens by design). So
 * the conversation is carried across by replaying a summary of the last turns
 * into the fresh session — imperfect next to true continuity, but it means a
 * long conversation carries on instead of stopping dead mid-sentence.
 */
function buildContinuationPrompt(turns: VoiceTurn[]): string {
  const recent = turns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-CARRIED_TURNS)
    .map((turn) => `${turn.role === "USER" ? "Them" : "You"}: ${turn.text.trim()}`)
    .join("\n");

  return [
    "[This is a continuation of a conversation you are already having with the learner — the connection was renewed, which is a technical detail they do not need to know about.",
    "Here is what the two of you were just saying:",
    recent,
    "Carry straight on from here. Do not greet them again, do not introduce yourself, and never mention the connection, the session, or that anything restarted. Pick the thread back up as if nothing happened.]",
  ].join("\n");
}

export interface VoiceSessionState {
  status: VoiceStatus;
  turns: VoiceTurn[];
  /** 0-1 microphone level, for the meter. */
  inputLevel: number;
  isMuted: boolean;
  error: string | null;
  /** Seconds since the conversation connected. */
  elapsedSec: number;
  /**
   * The provider has warned that it is about to close the session. Shown so a
   * cutoff is never a surprise mid-sentence.
   */
  endingSoon: boolean;
}

export function useVoiceSession() {
  const [state, setState] = useState<VoiceSessionState>({
    status: "idle",
    turns: [],
    inputLevel: 0,
    isMuted: false,
    error: null,
    elapsedSec: 0,
    endingSoon: false,
  });

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  /*
   * Distinguishes the learner hanging up from the socket closing on its own, so
   * an intentional stop isn't treated as a failure.
   */
  const stoppedRef = useRef(false);
  const reconnectRef = useRef<(() => void) | null>(null);

  /*
   * State for rolling a conversation onto a new session when the provider's
   * duration cap is reached. `turns` mirrors the transcript so the continuation
   * prompt can be built inside a callback without depending on render state.
   */
  const scenarioRef = useRef<string | undefined>(undefined);
  const continuationsRef = useRef(0);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const elapsedBeforeRef = useRef(0);

  /** Turn ids currently being appended to, one per speaker. */
  const openTurnRef = useRef<{ user: string | null; assistant: string | null }>({
    user: null,
    assistant: null,
  });

  /** Appends streamed transcript text to the open turn for a speaker. */
  const appendTranscript = useCallback((role: "USER" | "ASSISTANT", text: string) => {
    if (!text) return;

    setState((current) => {
      const key = role === "USER" ? "user" : "assistant";
      const openId = openTurnRef.current[key];

      if (openId) {
        return {
          ...current,
          turns: current.turns.map((turn) =>
            turn.id === openId ? { ...turn, text: turn.text + text } : turn,
          ),
        };
      }

      const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      openTurnRef.current[key] = id;

      return {
        ...current,
        turns: [...current.turns, { id, role, text, isPartial: true, at: Date.now() }],
      };
    });
  }, []);

  /** Marks a speaker's turn finished so the next text starts a new entry. */
  const closeTurn = useCallback((role: "USER" | "ASSISTANT") => {
    const key = role === "USER" ? "user" : "assistant";
    const openId = openTurnRef.current[key];
    if (!openId) return;

    openTurnRef.current[key] = null;
    setState((current) => ({
      ...current,
      turns: current.turns.map((turn) =>
        turn.id === openId ? { ...turn, isPartial: false } : turn,
      ),
    }));
  }, []);

  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    try {
      sessionRef.current?.close();
    } catch {
      // Already closed.
    }
    sessionRef.current = null;
    openTurnRef.current = { user: null, assistant: null };
  }, []);

  const handleMessage = useCallback(
    (message: LiveServerMessage) => {
      const content = message.serverContent;

      /*
       * The server warns before it hangs up. Surfacing it turns an unexplained
       * mid-sentence cutoff into something the learner can see coming, and
       * records why it happened rather than leaving it to be guessed at.
       */
      if (message.goAway) {
        console.warn("[voice] server signalled the session is ending", {
          timeLeft: message.goAway.timeLeft,
        });
        setState((current) => ({ ...current, endingSoon: true }));
      }

      // The learner started talking over the AI: drop queued speech at once, or
      // the AI keeps talking for seconds after it has stopped generating.
      if (content?.interrupted) {
        playerRef.current?.interrupt();
        closeTurn("ASSISTANT");
      }

      if (content?.inputTranscription?.text) {
        appendTranscript("USER", content.inputTranscription.text);
      }
      if (content?.outputTranscription?.text) {
        appendTranscript("ASSISTANT", content.outputTranscription.text);
      }

      for (const part of content?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          playerRef.current?.enqueue(part.inlineData.data);
        }
      }

      if (content?.turnComplete) {
        closeTurn("USER");
        closeTurn("ASSISTANT");
      }
    },
    [appendTranscript, closeTurn],
  );

  // Mirrors the transcript into a ref so the continuation handler can read the
  // latest turns without being recreated on every transcript update.
  useEffect(() => {
    turnsRef.current = state.turns;
  }, [state.turns]);

  /**
   * Opens the WebSocket for a call using a freshly minted grant.
   *
   * `seed` carries a continued conversation into a new session; omitted, the
   * session opens fresh and the tutor greets the learner.
   */
  const openSocket = useCallback(
    async (grant: SessionGrant, seed?: string): Promise<Session> => {
      const client = new GoogleGenAI({
        apiKey: grant.token,
        httpOptions: { apiVersion: grant.apiVersion },
      });

      const session = await client.live.connect({
        model: grant.model,
        /*
         * The system instruction, voice and transcription settings are locked
         * into the token, so nothing behavioural is sent from here.
         *
         * Compression is repeated deliberately: it is declared in the token's
         * constraints too, but a config supplied at connect time can take the
         * place of the constrained one rather than merging with it. Sending it
         * from both sides covers either behaviour. It keeps the context from
         * filling; it does not extend the session's own duration limit.
         */
        config: {
          responseModalities: [Modality.AUDIO],
          contextWindowCompression: {
            triggerTokens: VOICE_COMPRESSION_TRIGGER_TOKENS,
            slidingWindow: { targetTokens: VOICE_COMPRESSION_TARGET_TOKENS },
          },
          // Repeated for the same reason as compression: a connect-time config
          // can replace the token's rather than merge with it, and losing this
          // would leave the tutor answering from stale training data.
          tools: [{ googleSearch: {} }],
        },
        callbacks: {
          onopen: () => {
            startedAtRef.current = Date.now();
            setState((current) => ({ ...current, status: "listening", endingSoon: false }));
          },
          onmessage: handleMessage,
          onerror: () => {
            // Let `onclose` decide: it always follows, and reconnecting from
            // both handlers would open two sockets for one drop.
          },
          onclose: () => {
            sessionRef.current = null;
            if (stoppedRef.current) return;
            reconnectRef.current?.();
          },
        },
      });

      /*
       * Open the conversation, or pick it back up.
       *
       * Sent after `connect()` resolves because the session object does not
       * exist before then. Neither cue is ever displayed: the transcript is
       * driven by the provider's own speech transcription, so text sent this way
       * cannot reach the UI or the saved conversation.
       */
      try {
        session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: seed ?? KICKOFF_PROMPT }] }],
          turnComplete: true,
        });
      } catch {
        // Not fatal — on a fresh call the learner can simply speak first.
      }

      return session;
    },
    [handleMessage],
  );

  /*
   * Rolls the conversation onto a fresh session when the provider drops this
   * one.
   *
   * The provider ends a live session after roughly ten minutes regardless of
   * how much context has been used — measured directly, a silent, near-empty
   * session is still told to go away at nine minutes. Its own resumption
   * handles cannot carry the state across, because they only work between
   * sockets sharing one long-lived API key and this browser holds single-use
   * tokens by design.
   *
   * So the conversation is continued rather than resumed: a new session is
   * opened and seeded with the last few turns, keeping the microphone and
   * speaker running throughout. The learner hears a pause, not an ending.
   */
  const continueSession = useCallback(async () => {
    if (stoppedRef.current) return;

    const endCall = () => {
      setState((current) =>
        current.status === "error" ? current : { ...current, status: "ended", inputLevel: 0 },
      );
      teardown();
    };

    if (continuationsRef.current >= MAX_CONTINUATIONS || turnsRef.current.length === 0) {
      endCall();
      return;
    }

    continuationsRef.current += 1;
    // The clock keeps running across the join, so the saved duration reflects
    // how long the learner actually spoke.
    elapsedBeforeRef.current += Math.floor((Date.now() - startedAtRef.current) / 1000);
    setState((current) => ({ ...current, status: "reconnecting" }));

    const carried = buildContinuationPrompt(turnsRef.current);

    try {
      const grant = await apiPost<SessionGrant>("/api/ai/voice/session", {
        scenarioId: scenarioRef.current,
      });
      if (stoppedRef.current) return;

      const session = await openSocket(grant, carried);
      sessionRef.current = session;
    } catch (error) {
      console.warn("[voice] could not continue the conversation", error);
      endCall();
    }
  }, [openSocket, teardown]);

  useEffect(() => {
    reconnectRef.current = () => void continueSession();
  }, [continueSession]);

  const start = useCallback(
    async (options: { scenarioId?: string } = {}) => {
      if (!isVoiceSupported()) {
        setState((current) => ({
          ...current,
          status: "error",
          error:
            "This browser can't do live voice. Try Chrome, Edge or Safari on a device with a microphone.",
        }));
        return;
      }

      stoppedRef.current = false;
      scenarioRef.current = options.scenarioId;
      continuationsRef.current = 0;
      elapsedBeforeRef.current = 0;
      turnsRef.current = [];

      setState({
        status: "requesting-mic",
        turns: [],
        inputLevel: 0,
        isMuted: false,
        error: null,
        elapsedSec: 0,
        endingSoon: false,
      });

      // Playback must be unlocked from the user gesture that started the call.
      const player = new AudioPlayer({
        onStateChange: (isPlaying) =>
          setState((current) =>
            current.status === "listening" || current.status === "speaking"
              ? { ...current, status: isPlaying ? "speaking" : "listening" }
              : current,
          ),
      });
      playerRef.current = player;
      await player.unlock();

      let grant: SessionGrant;
      try {
        grant = await apiPost<SessionGrant>("/api/ai/voice/session", {
          scenarioId: options.scenarioId,
        });
      } catch (error) {
        teardown();
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof ApiError
              ? error.message
              : "We couldn't start the conversation. Please try again.",
        }));
        return;
      }

      setState((current) => ({ ...current, status: "connecting" }));

      try {
        sessionRef.current = await openSocket(grant);

        const mic = new MicCapture();
        micRef.current = mic;

        await mic.start({
          onChunk: (base64) => {
            try {
              sessionRef.current?.sendRealtimeInput({
                audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
              });
            } catch {
              // The session closed between capture and send; the close handler
              // has already dealt with it.
            }
          },
          onLevel: (level) => setState((current) => ({ ...current, inputLevel: level })),
        });

        timerRef.current = setInterval(() => {
          setState((current) => ({
            ...current,
            // Time from earlier stretches is carried, so a conversation that has
            // rolled onto a new session still shows its true total.
            elapsedSec:
              elapsedBeforeRef.current + Math.floor((Date.now() - startedAtRef.current) / 1000),
          }));
        }, 1000);
      } catch (error) {
        teardown();

        const name = error instanceof DOMException ? error.name : "";
        const message =
          name === "NotAllowedError" || name === "SecurityError"
            ? "Microphone access was blocked. Allow it in your browser's site settings, then try again."
            : name === "NotFoundError"
              ? "We couldn't find a microphone. Check that one is connected."
              : name === "NotReadableError"
                ? "Your microphone is in use by another app. Close it and try again."
                : "We couldn't start the conversation. Please try again.";

        setState((current) => ({ ...current, status: "error", error: message }));
      }
    },
    [openSocket, teardown],
  );

  const stop = useCallback(() => {
    // Set before teardown so the close handler treats this as intentional and
    // doesn't try to reconnect the call the learner just ended.
    stoppedRef.current = true;
    teardown();
    setState((current) => ({ ...current, status: "ended", inputLevel: 0 }));
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const mic = micRef.current;
    if (!mic) return;
    const next = !mic.isMuted();
    mic.setMuted(next);
    setState((current) => ({ ...current, isMuted: next, inputLevel: 0 }));
  }, []);

  /** Lets the learner type instead — useful in a quiet room or a noisy one. */
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRef.current) return;
      appendTranscript("USER", trimmed);
      closeTurn("USER");
      sessionRef.current.sendClientContent({ turns: trimmed, turnComplete: true });
    },
    [appendTranscript, closeTurn],
  );

  return { state, start, stop, toggleMute, sendText };
}
