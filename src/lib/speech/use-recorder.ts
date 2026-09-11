"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Microphone recording.
 *
 * Handles the failure modes the spec calls out explicitly — unsupported
 * browser, denied permission, no microphone, empty recording — as distinct
 * states, because each one needs different advice for the user.
 */

export type RecorderStatus =
  "idle" | "requesting" | "recording" | "processing" | "unsupported" | "denied" | "error";

export interface RecorderState {
  status: RecorderStatus;
  /** Seconds elapsed in the current recording. */
  elapsedSec: number;
  error: string | null;
}

/** Codecs in order of preference; the first the browser supports wins. */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Anything shorter than this is almost certainly a mis-click. */
const MIN_RECORDING_MS = 700;
/** Hard stop so a forgotten recording can't run for hours. */
const MAX_RECORDING_MS = 5 * 60 * 1000;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: "idle",
    elapsedSec: 0,
    error: null,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Releases the microphone and clears timers. */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    // Stopping the tracks turns off the browser's recording indicator, which
    // matters: leaving it on looks like the app is still listening.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState({
        status: "unsupported",
        elapsedSec: 0,
        error:
          "Your browser doesn't support microphone recording. Try Chrome, Edge, Firefox or Safari.",
      });
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setState({
        status: "unsupported",
        elapsedSec: 0,
        error: "Your browser can't record audio. Try a different browser.",
      });
      return;
    }

    setState({ status: "requesting", elapsedSec: 0, error: null });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";

      if (name === "NotAllowedError" || name === "SecurityError") {
        setState({
          status: "denied",
          elapsedSec: 0,
          error:
            "Microphone access was blocked. Allow it in your browser's site settings, then try again.",
        });
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setState({
          status: "error",
          elapsedSec: 0,
          error: "We couldn't find a microphone. Check that one is connected.",
        });
      } else if (name === "NotReadableError") {
        setState({
          status: "error",
          elapsedSec: 0,
          error: "Your microphone is being used by another app. Close it and try again.",
        });
      } else {
        setState({
          status: "error",
          elapsedSec: 0,
          error: "We couldn't start recording. Please try again.",
        });
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.start(250);
    startedAtRef.current = Date.now();

    setState({ status: "recording", elapsedSec: 0, error: null });

    timerRef.current = setInterval(() => {
      setState((current) =>
        current.status === "recording"
          ? { ...current, elapsedSec: Math.floor((Date.now() - startedAtRef.current) / 1000) }
          : current,
      );
    }, 250);

    maxTimerRef.current = setTimeout(() => {
      recorderRef.current?.stop();
    }, MAX_RECORDING_MS);
  }, []);

  /** Stops recording and resolves with the audio, or null if it was unusable. */
  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;

      if (!recorder || recorder.state === "inactive") {
        cleanup();
        setState({ status: "idle", elapsedSec: 0, error: null });
        resolve(null);
        return;
      }

      const durationMs = Date.now() - startedAtRef.current;

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        cleanup();
        chunksRef.current = [];

        if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
          setState({
            status: "error",
            elapsedSec: 0,
            error: "That was too short to hear. Hold the button and speak for a moment longer.",
          });
          resolve(null);
          return;
        }

        setState({ status: "processing", elapsedSec: 0, error: null });
        resolve(blob);
      };

      recorder.stop();
    });
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setState({ status: "idle", elapsedSec: 0, error: null });
  }, [cleanup]);

  const setError = useCallback((message: string) => {
    setState({ status: "error", elapsedSec: 0, error: message });
  }, []);

  return { state, start, stop, reset, setError };
}
