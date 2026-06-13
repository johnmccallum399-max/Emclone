import { useCallback, useRef, useState } from "react";
import { speakText } from "../api/client";
import { getSpeechRecognition, type VoiceController } from "./types";

/**
 * Hybrid voice mode: free browser speech recognition for input, OpenAI TTS
 * (via the backend) for higher-quality spoken output.
 */
export function useBrowserVoice(onTranscript: (text: string) => void): VoiceController {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const RecognitionCtor = getSpeechRecognition();
  const supported = !!RecognitionCtor;

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
    if (!text.trim()) return;
    setIsSpeaking(true);
    try {
      const blob = await speakText(text);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  return { isListening, isSpeaking, supported, error, start, stop, speak };
}
