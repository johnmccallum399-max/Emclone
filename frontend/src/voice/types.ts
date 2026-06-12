export interface VoiceController {
  /** Whether the microphone is actively capturing speech. */
  isListening: boolean;
  /** Whether the assistant's voice is currently playing. */
  isSpeaking: boolean;
  /** Whether this voice mode is supported in the current browser. */
  supported: boolean;
  /** Human-readable error, if any. */
  error: string | null;
  /** Begin listening for a single utterance. */
  start: () => void;
  /** Stop listening (and, for recorder-based modes, finalize the utterance). */
  stop: () => void;
  /** Speak the given text using this mode's TTS (no-op for realtime). */
  speak: (text: string) => Promise<void>;
}

export function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}
