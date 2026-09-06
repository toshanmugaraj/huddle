// Ambient declarations for the Web Speech API's *recognition* half (speech
// synthesis is properly typed in TypeScript's own lib.dom.d.ts — this file
// only fills what's missing). SpeechRecognitionAlternative/Result/ResultList
// ARE already in lib.dom.d.ts (hence no re-declaration here), but the
// interface actually implementing speech-to-text, its event types, and the
// window globals are not — this API never made it past a non-standard,
// webkit-prefixed-only implementation (Chrome/Edge), so no browser ships an
// unprefixed `SpeechRecognition` global either. See
// src/hooks/useSpeechRecognition.ts for the feature-detection that reads
// these.

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  abort(): void;
  start(): void;
  stop(): void;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported';

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode;
  readonly message: string;
}

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
