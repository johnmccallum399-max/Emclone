import { useCallback, useRef, useState } from "react";
import { getSpeechRecognition, type VoiceController } from "./types";

/**
 * Fully client-side voice mode: browser Web Speech API for both speech
 * recognition (input) and speech synthesis (output). Zero API cost and
 * works offline-ish, but quality/availability depends on the browser.
 */
export function useNativeVoice(onTranscript: (text: string) => void): VoiceController {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const RecognitionCtor = getSpeechRecognition();
  const supported = !!RecognitionCtor && typeof window !== "undefined" && "speechSynthesis" in window;

  const start = useCallback(() => {
    if (!RecognitionCtor) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }
    setError(null);

    const recognition = new RecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      if (transcript.trim()) onTranscript(transcript.trim());
    };
    recognition.onerror = (event) => {
      setError(event.error || "Speech recognition error");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [RecognitionCtor, onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const speak = useCallback(async (text: string): Promise<void> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  return { isListening, isSpeaking, supported, error, start, stop, speak };
}
