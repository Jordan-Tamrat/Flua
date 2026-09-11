/**
 * Text-to-speech abstraction (client side).
 *
 * The browser's own SpeechSynthesis is the default provider: it is free, needs
 * no API key, works offline, and adds no server cost — which matters for a
 * free-tier-first product. The `TTSProvider` shape below is the seam where a
 * cloud voice would slot in later without touching any calling code.
 */

export interface SpeakOptions {
  /** 0.5-2.0, where 1 is the voice's natural pace. */
  rate?: number;
  pitch?: number;
  /** BCP-47 tag. Defaults to en-US. */
  lang?: string;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface TTSProvider {
  readonly name: string;
  isSupported(): boolean;
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
}

/** Browser-native synthesis. No network, no key, no cost. */
class BrowserSpeechProvider implements TTSProvider {
  readonly name = "browser";

  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  speak(text: string, options: SpeakOptions = {}): void {
    if (!this.isSupported()) {
      options.onError?.("Your browser doesn't support speech playback.");
      return;
    }

    // Overlapping utterances queue up rather than replace, which sounds broken.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang ?? "en-US";
    utterance.rate = Math.min(2, Math.max(0.5, options.rate ?? 1));
    utterance.pitch = options.pitch ?? 1;

    // Prefer a voice matching the requested language; the browser's default
    // may be for the OS locale rather than English.
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang.startsWith(utterance.lang.slice(0, 2)));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => options.onEnd?.();
    utterance.onerror = (event) => {
      // Cancelling produces an "interrupted" error that isn't worth surfacing.
      if (event.error === "interrupted" || event.error === "canceled") {
        options.onEnd?.();
        return;
      }
      options.onError?.("We couldn't play that audio.");
      options.onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }
}

const provider: TTSProvider = new BrowserSpeechProvider();

export function isSpeechSynthesisSupported(): boolean {
  return provider.isSupported();
}

export function speak(text: string, options?: SpeakOptions): void {
  provider.speak(text, options);
}

export function cancelSpeech(): void {
  provider.cancel();
}

export function getTTSProviderName(): string {
  return provider.name;
}
