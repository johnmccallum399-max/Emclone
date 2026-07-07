import { useCallback, useRef, useState } from "react";
import { createRealtimeSession } from "../api/client";

export interface RealtimeTranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

interface RealtimeEvent {
  type: string;
  transcript?: string;
  [key: string]: unknown;
}

/**
 * Manages a live, full-duplex voice session with the OpenAI Realtime API
 * over WebRTC. The backend mints a short-lived ephemeral token
 * (`/api/voice/realtime-session`); the browser then connects directly to
 * OpenAI so audio never round-trips through our server.
 *
 * Mic audio is routed through a Web Audio GainNode so gain can be adjusted
 * live without renegotiating the peer connection.
 */
export function useRealtimeSession() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<RealtimeTranscriptEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [gain, setGainState] = useState(1.0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const gainRef = useRef(1.0);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;

    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    gainNodeRef.current = null;

    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }

    setConnected(false);
    setMuted(false);
  }, []);

  const handleEvent = useCallback((event: RealtimeEvent) => {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          setTranscripts((prev) => [...prev, { role: "user", text: String(event.transcript) }]);
        }
        break;
      case "response.audio_transcript.done":
        if (event.transcript) {
          setTranscripts((prev) => [...prev, { role: "assistant", text: String(event.transcript) }]);
        }
        break;
      case "error":
        setError(typeof event.error === "string" ? event.error : "Realtime session error");
        break;
      default:
        break;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      streamRef.current?.getTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  const setGain = useCallback((value: number) => {
    gainRef.current = value;
    setGainState(value);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = value;
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setTranscripts([]);
    setMuted(false);

    try {
      const session = await createRealtimeSession();
      const ephemeralKey: string | undefined = session?.clientSecret;
      if (!ephemeralKey) {
        throw new Error("Realtime session response did not include a client secret.");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Route mic through a GainNode so gain (and mute via track.enabled) can
      // be adjusted live without touching the peer connection.
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = gainRef.current;
      gainNodeRef.current = gainNode;
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(stream).connect(gainNode);
      gainNode.connect(dest);

      dest.stream.getTracks().forEach((track) => pc.addTrack(track, dest.stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => {
        try {
          handleEvent(JSON.parse(e.data) as RealtimeEvent);
        } catch {
          // ignore malformed events
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // GA SDP-exchange endpoint: the model is already bound to the ephemeral
      // key from /v1/realtime/client_secrets, so it's not passed here. The
      // older /v1/realtime?model=... Beta shape was retired and now 400s.
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Failed to connect to the realtime API (status ${sdpResponse.status}).`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setConnected(true);
    } catch (err) {
      setError((err as Error).message);
      disconnect();
    } finally {
      setConnecting(false);
    }
  }, [disconnect, handleEvent]);

  return { connected, connecting, error, transcripts, muted, gain, connect, disconnect, toggleMute, setGain };
}
