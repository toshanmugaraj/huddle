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
}

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
  // Asking for Markdown, not HTML: every model tried — Gemini included, and
  // especially the on-device Gemma — reliably ignores an "output raw HTML
  // tags" instruction and writes Markdown anyway, presumably because
  // that's what training data biases it toward regardless of the prompt.
  // sanitizeSummaryHtml.ts now runs the response through a real Markdown
  // parser before sanitizing, so asking for the format models actually
  // produce is both simpler to write and more reliable than fighting that
  // bias — see that file's comment for the fuller story.
  instruction:
    'Summarize the unread messages below in 3-5 concise bullet points. Call out any direct ' +
    'questions or action items addressed to me. Format the response as simple Markdown: a bullet ' +
    'list (-), **bold** for emphasis, no headings, no links, no code blocks.',
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
