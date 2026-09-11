"use client";

/**
 * Browser audio plumbing for live voice.
 *
 * The Live API speaks raw PCM in both directions, at different rates for each:
 * it wants 16 kHz mono little-endian 16-bit in, and sends 24 kHz mono out.
 * Getting either rate wrong produces audio that plays at the wrong speed rather
 * than failing loudly, so both are pinned here as named constants.
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

/** ~128ms of audio per message: small enough to feel live, large enough not to spam. */
const CAPTURE_BUFFER_SIZE = 2048;

/* -------------------------------------------------------------------------- */
/*                               Encoding helpers                             */
/* -------------------------------------------------------------------------- */

/** Float32 (-1..1) to little-endian signed 16-bit PCM, then base64. */
export function float32ToPcm16Base64(input: Float32Array): string {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < input.length; index += 1) {
    // Clamp before scaling: values slightly outside the range would otherwise
    // wrap around and produce loud clicks.
    const clamped = Math.max(-1, Math.min(1, input[index] ?? 0));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return arrayBufferToBase64(buffer);
}

/**
 * Base64 PCM16 to a Float32Array suitable for an AudioBuffer.
 *
 * The explicit `ArrayBuffer` type parameter matters: `copyToChannel` will not
 * accept a Float32Array that might be backed by a SharedArrayBuffer.
 */
export function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const view = new DataView(buffer);
  const samples = new Float32Array(new ArrayBuffer(Math.floor(binary.length / 2) * 4));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return samples;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked to avoid blowing the argument limit on long buffers.
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/* -------------------------------------------------------------------------- */
/*                              Microphone capture                            */
/* -------------------------------------------------------------------------- */

export interface MicCaptureOptions {
  /** Called with each base64 PCM16 chunk, ready to send. */
  onChunk: (base64: string) => void;
  /** Rough input level 0-1, for the level meter. */
  onLevel?: (level: number) => void;
}

/**
 * Captures microphone audio as 16 kHz PCM.
 *
 * Uses `ScriptProcessorNode` rather than an AudioWorklet: it is deprecated but
 * universally supported, and a worklet would need a separate module file served
 * at a stable URL for a modest benefit at this buffer size.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private muted = false;

  async start(options: MicCaptureOptions): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.stream = stream;

    // Asking for the target rate directly avoids resampling in most browsers.
    const context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    this.context = context;

    // Some browsers start the context suspended until a user gesture.
    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
      if (this.muted) return;

      const input = event.inputBuffer.getChannelData(0);

      if (options.onLevel) {
        // Root-mean-square is a better perceptual match for "loudness" than peak.
        let sum = 0;
        for (let index = 0; index < input.length; index += 1) {
          const sample = input[index] ?? 0;
          sum += sample * sample;
        }
        options.onLevel(Math.min(1, Math.sqrt(sum / input.length) * 4));
      }

      options.onChunk(float32ToPcm16Base64(input));
    };

    source.connect(processor);
    // A ScriptProcessorNode only fires while connected to a destination. Routing
    // through a silent gain node keeps it running without echoing the mic.
    const silence = context.createGain();
    silence.gain.value = 0;
    processor.connect(silence);
    silence.connect(context.destination);

    this.source = source;
    this.processor = processor;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    // Stopping the tracks turns off the browser's recording indicator — leaving
    // it on makes it look like the app is still listening.
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);

    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

/* -------------------------------------------------------------------------- */
/*                               Audio playback                               */
/* -------------------------------------------------------------------------- */

/**
 * Gap-free playback of streamed PCM chunks.
 *
 * Chunks arrive faster than real time, so each is scheduled at the end of the
 * previous one rather than played on arrival — otherwise they overlap and the
 * speech becomes unintelligible. `interrupt()` drops everything queued, which
 * is what makes barge-in feel instant.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;
  private active = new Set<AudioBufferSourceNode>();
  private onStateChange?: (isPlaying: boolean) => void;

  constructor(options: { onStateChange?: (isPlaying: boolean) => void } = {}) {
    this.onStateChange = options.onStateChange;
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    return this.context;
  }

  /** Must be called from a user gesture so playback is permitted. */
  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  enqueue(base64Pcm: string): void {
    const context = this.ensureContext();
    const samples = pcm16Base64ToFloat32(base64Pcm);
    if (samples.length === 0) return;

    const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    // A small lead time absorbs jitter without an audible delay.
    const startAt = Math.max(context.currentTime + 0.04, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    const wasIdle = this.active.size === 0;
    this.active.add(source);
    if (wasIdle) this.onStateChange?.(true);

    source.onended = () => {
      this.active.delete(source);
      if (this.active.size === 0) this.onStateChange?.(false);
    };
  }

  /** Stops everything immediately — used when the learner talks over the AI. */
  interrupt(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // Already finished; nothing to stop.
      }
    }
    this.active.clear();
    this.nextStartTime = this.context?.currentTime ?? 0;
    this.onStateChange?.(false);
  }

  close(): void {
    this.interrupt();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}

/** Whether this browser can do live voice at all. */
export function isVoiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined"
  );
}
