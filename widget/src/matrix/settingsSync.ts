import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { SETTINGS_EVENT_TYPE } from '../capabilities';
import type { GemmaModelId } from '../model/GemmaEdgeModel';
import type { GeminiModelId } from '../model/geminiModel';

export type SummarizationMode = 'local' | 'gemini';

export interface ChatSummarySettings {
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

export const DEFAULT_SETTINGS: ChatSummarySettings = {
  roomIds: [],
  // Defaults to the private, on-device path — Gemini is opt-in, never the
  // silent default, since sending message content off-device is a real
  // choice the user has to make deliberately in Settings.
  mode: 'local',
  localModel: 'gemma-3n-e2b',
  geminiModel: 'gemini-3.6-flash',
  instruction:
    'Summarize the unread messages below in 3-5 concise bullet points. Call out any direct ' +
    'questions or action items addressed to me. Format the response as simple HTML using only ' +
    '<p>, <ul>, <li>, <b>, and <br> tags — no markdown syntax (no **, no #, no ---), no other ' +
    'HTML tags, no attributes.',
};

// Settings are stored as a state event in the widget's own room, keyed by
// the user's Matrix ID as the state key — so multiple members using the
// same widget instance in a room don't overwrite each other's settings.

export async function loadSettings(widgetApi: WidgetApi, userId: string): Promise<ChatSummarySettings> {
  const event = await widgetApi.receiveSingleStateEvent<Partial<ChatSummarySettings>>(
    SETTINGS_EVENT_TYPE,
    userId,
  );
  return { ...DEFAULT_SETTINGS, ...event?.content };
}

export async function saveSettings(
  widgetApi: WidgetApi,
  userId: string,
  settings: ChatSummarySettings,
): Promise<void> {
  await widgetApi.sendStateEvent(SETTINGS_EVENT_TYPE, settings, { stateKey: userId });
}

export function observeSettings(widgetApi: WidgetApi, userId: string) {
  return widgetApi.observeStateEvents<Partial<ChatSummarySettings>>(SETTINGS_EVENT_TYPE, {
    stateKey: userId,
  });
}
