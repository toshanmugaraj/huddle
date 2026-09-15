import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { SETTINGS_EVENT_TYPE } from '../capabilities';
import type { GemmaModelId } from '../model/GemmaEdgeModel';
import type { GeminiModelId } from '../model/geminiModel';

export type SummarizationMode = 'local' | 'gemini';

export interface HuddleSettings {
  /** Room IDs the user has opted into summarizing, chosen from their joined rooms. */
  roomIds: string[];
  /** 'local' = on-device Gemma, nothing leaves the browser. 'gemini' = Google's hosted API — messages ARE sent off-device. */
  mode: SummarizationMode;
  localModel: GemmaModelId;
  geminiModel: GeminiModelId;
  instruction: string;
  /**
   * How many *extra* calendar days before today Sync also pulls in — 0 is
   * today only (this app's original, and still the default, behavior); N
   * extends that window to include the N previous days too, so the total
   * span covered is N+1 calendar days. Deliberately not "N = total days":
   * that reading makes 0 and 1 both mean "today only" (last 1 day = last 0
   * days), an indistinguishable, do-nothing slider step right where a user
   * is most likely to try it first. See Home.tsx's history slider and
   * matrix/messages.ts's getMessagesSince, which this is passed straight
   * into.
   */
  historyDaysBack: number;
  /**
   * Target language for both the summary (title/points — see
   * agent/summarize.ts's languageInstruction) and, on request, the
   * citation dialog's translated message previews (agent/translate.ts) —
   * one language setting drives both, so there's no separate "translate
   * to X" picker duplicating this. Empty string ('') is "Auto": write in
   * whatever language the messages are already in, no translation
   * requested anywhere, today's original behavior. A non-empty value is
   * one of LANGUAGE_OPTIONS' `value`s — a plain language name (e.g.
   * "Spanish"), not an ISO code, since it's only ever interpolated into a
   * natural-language instruction for the model, never compared/parsed
   * programmatically.
   */
  language: string;
}

/**
 * Deliberately a short, curated list rather than free text — an unusual or
 * ambiguous string here goes straight into a model prompt with no
 * validation, and a fixed list keeps that input predictable. `value: ''`
 * is the "Auto" default; every other value is the literal language name
 * interpolated into agent/summarize.ts's languageInstruction and
 * agent/translate.ts's translation prompt.
 */
export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Auto (same language as the messages)' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Dutch', label: 'Dutch' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Chinese (Simplified)', label: 'Chinese (Simplified)' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Tamil', label: 'Tamil' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Russian', label: 'Russian' },
];

// The Gemini API key is deliberately NOT part of this interface — it lives
// in localStorage only (src/state/apiKeyStore.ts), never in this state
// event. See that file's comment for why: state events are plain-text room
// state, not end-to-end encrypted, even in an "encrypted" room.

export const DEFAULT_SETTINGS: HuddleSettings = {
  roomIds: [],
  // Defaults to the private, on-device path — Gemini is opt-in, never the
  // silent default, since sending message content off-device is a real
  // choice the user has to make deliberately in Settings.
  mode: 'local',
  localModel: 'gemma-4-e2b',
  geminiModel: 'gemini-3.6-flash',
  historyDaysBack: 0,
  language: '',
  // No format instructions here at all any more (no "- Date: " / "- Topic:
  // summary" Markdown convention) — summarizeRoom (agent/summarize.ts) gets
  // its output shape from a Zod structuredOutputSchema now, not from asking
  // nicely in prose. That sidesteps, rather than fights, the exact
  // instruction-following problem that motivated the old Markdown
  // convention in the first place: every model tried — Gemini included, and
  // especially the on-device Gemma — reliably ignored format instructions
  // given as prose. A schema-validated tool call doesn't have that failure
  // mode the same way (see summarize.ts's own comment on the one real
  // remaining gap: GemmaEdgeModel can't be FORCED to call it, so a
  // sufficiently uncooperative local-mode response still surfaces as a
  // failed Sync rather than a malformed one).
  instruction:
    'You are an expert technical documentation assistant summarizing the given messages in this ' +
    'room. Ignore off-topic banter, jokes, or ambient greetings — don\'t create a topic for them. ' +
    'Group related discussion into clear, distinct topics rather than a chronological recap. Call ' +
    'out any direct questions or action items addressed to me as their own topic. Write each point ' +
    'as a plain sentence — no Markdown formatting, no bold, no headings, no links, no code blocks.',
};

// Settings are stored as a state event in the widget's own room, keyed by
// the user's Matrix ID as the state key — so multiple members using the
// same widget instance in a room don't overwrite each other's settings.

export async function loadSettings(widgetApi: WidgetApi, userId: string): Promise<HuddleSettings> {
  const event = await widgetApi.receiveSingleStateEvent<Partial<HuddleSettings>>(
    SETTINGS_EVENT_TYPE,
    userId,
  );
  return { ...DEFAULT_SETTINGS, ...event?.content };
}

export async function saveSettings(
  widgetApi: WidgetApi,
  userId: string,
  settings: HuddleSettings,
): Promise<void> {
  await widgetApi.sendStateEvent(SETTINGS_EVENT_TYPE, settings, { stateKey: userId });
}

export function observeSettings(widgetApi: WidgetApi, userId: string) {
  return widgetApi.observeStateEvents<Partial<HuddleSettings>>(SETTINGS_EVENT_TYPE, {
    stateKey: userId,
  });
}
