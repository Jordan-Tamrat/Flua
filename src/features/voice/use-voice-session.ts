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
 * the token. Audio fills a context window quickly; without compression the
 * session is terminated once it is full, roughly ten minutes in.
 */
const VOICE_COMPRESSION_TRIGGER_TOKENS = "16000";
const VOICE_COMPRESSION_TARGET_TOKENS = "8000";

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

  /** Opens the WebSocket for a call using a freshly minted grant. */
  const openSocket = useCallback(
    async (grant: SessionGrant): Promise<Session> => {
      const client = new GoogleGenAI({
        apiKey: grant.token,
        httpOptions: { apiVersion: grant.apiVersion },
      });

      return client.live.connect({
        model: grant.model,
        /*
         * The system instruction, voice and transcription settings are locked
         * into the token, so nothing behavioural is sent from here.
         *
         * Context window compression is the exception, repeated deliberately.
         * Without it a session is terminated once its context fills with audio,
         * roughly ten minutes in. It is declared in the token's constraints too,
         * but a config supplied at connect time can take the place of the
         * constrained one rather than merging with it, which would silently drop
         * compression and reinstate the cutoff. Sending it from both sides
         * covers either behaviour.
         */
        config: {
          responseModalities: [Modality.AUDIO],
          contextWindowCompression: {
            triggerTokens: VOICE_COMPRESSION_TRIGGER_TOKENS,
            slidingWindow: { targetTokens: VOICE_COMPRESSION_TARGET_TOKENS },
          },
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
    },
    [handleMessage],
  );

  /*
   * Ends the call when the socket closes on its own.
   *
   * Automatic resumption was tried here and removed. The provider does issue
   * resumption handles, and resuming genuinely restores the conversation — but
   * only when both sockets authenticate with the same long-lived API key.
   * Flua's browser only ever holds a single-use ephemeral token, so a handle
   * from one token cannot be resumed under the next one: the socket reopens,
   * and the tutor has forgotten the entire conversation. Reconnecting into a
   * blank session mid-sentence is worse than stopping, so the call ends and the
   * transcript is saved instead.
   */
  const handleUnexpectedClose = useCallback(() => {
    setState((current) =>
      current.status === "error" ? current : { ...current, status: "ended", inputLevel: 0 },
    );
    teardown();
  }, [teardown]);

  useEffect(() => {
    reconnectRef.current = handleUnexpectedClose;
  }, [handleUnexpectedClose]);

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
        const session = await openSocket(grant);
        sessionRef.current = session;

        /*
         * Make the tutor speak first.
         *
         * The system instruction already tells it to open the conversation, but
         * the model generates nothing until a turn is addressed to it — so
         * without this the session sits in silence until the learner speaks,
         * which is backwards after they have just picked a scenario and are
         * waiting to be spoken to.
         *
         * Sent here rather than in `onopen` because the session object only
         * exists once `connect()` has resolved. The cue itself is never shown:
         * the transcript is driven by the provider's own transcription, which
         * covers speech only, so this text cannot leak into the UI or into the
         * saved conversation.
         */
        try {
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: KICKOFF_PROMPT }] }],
            turnComplete: true,
          });
        } catch {
          // Not fatal — the conversation still works, the learner just opens it.
        }

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
            elapsedSec: Math.floor((Date.now() - startedAtRef.current) / 1000),
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
