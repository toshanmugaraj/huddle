import { useCallback, useEffect, useState } from 'react';

/**
 * Wraps the browser's SpeechSynthesis API (fully typed in TS's own
 * lib.dom.d.ts already, unlike speech recognition — see
 * src/speechRecognition.d.ts) for reading assistant replies aloud in the
 * Chat tab's voice mode.
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      // Cancel whatever's currently queued/playing rather than stacking
      // utterances — voice mode should only ever be reading the latest
      // reply aloud, not backlogging every prior one if turns come quickly.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || 'en-US';
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // Stop any in-flight utterance if the component using this unmounts (tab
  // switch away from Chat) rather than leaving it talking over whatever's
  // shown next.
  useEffect(() => {
    if (!supported) return;
    return () => window.speechSynthesis.cancel();
  }, [supported]);

  return { supported, speaking, speak, stop };
}
