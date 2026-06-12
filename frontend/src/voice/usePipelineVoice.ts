import { useCallback, useRef, useState } from "react";
import { speakText, transcribeAudio } from "../api/client";
import type { VoiceController } from "./types";

/**
 * Push-to-talk voice mode: records audio with MediaRecorder, transcribes it
 * with OpenAI Whisper, and speaks replies with OpenAI TTS. Cheaper than the
 * realtime API and works in any browser that supports MediaRecorder.
 */
export function usePipelineVoice(onTranscript: (text: string) => void): VoiceController {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined";

  const start = useCallback(() => {
    if (!supported) {
      setError("Audio recording is not supported in this browser.");
      return;
    }
    setError(null);

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          setIsListening(false);
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size === 0) return;
          transcribeAudio(blob)
            .then((text) => {
              if (text.trim()) onTranscript(text.trim());
            })
            .catch((err) => setError((err as Error).message));
        };

        recorderRef.current = recorder;
        recorder.start();
        setIsListening(true);
      })
      .catch((err) => setError((err as Error).message));
  }, [supported, onTranscript]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
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
