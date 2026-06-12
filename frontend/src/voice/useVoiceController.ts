import type { VoiceMode } from "../types";
import { useBrowserVoice } from "./useBrowserVoice";
import { useNativeVoice } from "./useNativeVoice";
import { usePipelineVoice } from "./usePipelineVoice";
import type { VoiceController } from "./types";

/**
 * Selects the active voice controller for the given mode. All hooks are
 * called unconditionally (required by the rules of hooks); each is inert
 * until its `start`/`speak` methods are invoked. The "realtime" mode is
 * handled separately by `useRealtimeSession` + `RealtimeVoicePanel`.
 */
export function useVoiceController(mode: VoiceMode, onTranscript: (text: string) => void): VoiceController | null {
  const native = useNativeVoice(onTranscript);
  const browser = useBrowserVoice(onTranscript);
  const pipeline = usePipelineVoice(onTranscript);

  switch (mode) {
    case "native":
      return native;
    case "browser":
      return browser;
    case "pipeline":
      return pipeline;
    default:
      return null;
  }
}
