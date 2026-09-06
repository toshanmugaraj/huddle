import { useCallback, useEffect, useRef, useState } from 'react';

function getRecognitionCtor(): (new () => SpeechRecognition) | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Wraps the Web Speech API's speech-to-text side for the Chat tab's voice
 * mode — see src/speechRecognition.d.ts for why this needs its own ambient
 * type declarations (TypeScript's lib.dom.d.ts doesn't have them; this API
 * never standardized past a webkit-prefixed-only implementation).
 *
 * One recognition session per start() call, `continuous: false` — the
 * browser stops listening on its own after a pause in speech, at which
 * point either onFinalResult fires once with the best transcript, or
 * onend fires with nothing (silence/no match), and `listening` goes back
 * to false either way. There's no manual "are they done talking" guess to
 * get wrong here; the browser owns that call.
 *
 * NOTE — this may simply not work at all when this widget is embedded in
 * Element's widget iframe: getUserMedia-gated APIs are subject to the
 * embedding page's iframe `allow` attribute / Permissions-Policy, which is
 * Element's to grant, not something this widget's own code can request for
 * itself (unlike the Matrix Widget API capabilities in capabilities.ts).
 * Untested against a real Element host as of this writing — confirm
 * microphone access actually reaches this iframe before relying on it.
 */
export function useSpeechRecognition(onFinalResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Ref, not a dependency — callers pass an inline callback each render, and
  // re-running start's useCallback identity on every render would be a
  // pointless source of consumer-side effect churn for no behavior change.
  const onFinalResultRef = useRef(onFinalResult);
  onFinalResultRef.current = onFinalResult;

  const supported = typeof window !== 'undefined' && !!getRecognitionCtor();

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    if (recognitionRef.current) return; // already listening — ignore a double-tap

    const recognition = new Ctor();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) onFinalResultRef.current(transcript);
    };
    recognition.onerror = (event) => {
      // 'aborted' is what stop()/abort() themselves report — expected when
      // the user cancels or toggles voice mode off mid-recording, not a
      // real error. 'no-speech' (silence, nothing recognized) isn't worth
      // alarming the user over either; onend already resets `listening`.
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was denied for this widget.'
          : `Voice input error: ${event.error}`,
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setError(undefined);
    setListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Stop listening if the component using this unmounts mid-recognition
  // (e.g. the user switches away from the Chat tab) rather than leaking an
  // active mic session the UI no longer shows any indication of.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, error, start, stop };
}
