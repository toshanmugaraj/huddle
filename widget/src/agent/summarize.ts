import { Agent } from '@strands-agents/sdk';
import { GemmaEdgeModel, type GemmaModelId } from '../model/GemmaEdgeModel';
import { createGeminiModel, type GeminiModelId } from '../model/geminiModel';
import type { ChatSummarySettings } from '../matrix/settingsSync';
import type { UnreadMessage } from '../matrix/unread';
import { attachTraceLogging } from './trace';

// One GemmaEdgeModel per variant, cached for the widget's lifetime — the
// WASM runtime + loaded weights are expensive to set up, so this is what
// makes repeat local syncs fast after the first. There's no equivalent
// cache for Gemini: building a GoogleModel is cheap (no local warm-up), so
// summarizeRoom() just constructs one per call — see geminiModel.ts.
//
// Exported so chatAgent.ts's local-mode Chat tab shares this same warm
// instance instead of loading the multi-GB model a second time.
const localModelCache = new Map<GemmaModelId, GemmaEdgeModel>();

export function getLocalModel(modelId: GemmaModelId): GemmaEdgeModel {
  let model = localModelCache.get(modelId);
  if (!model) {
    model = new GemmaEdgeModel({ modelId });
    localModelCache.set(modelId, model);
  }
  return model;
}

/** Triggers on-device model load ahead of time so Settings/Home can show real "preparing" status before Sync needs it. No-op for Gemini — nothing to warm up. */
export async function prepareModel(modelId: GemmaModelId): Promise<void> {
  await getLocalModel(modelId).warmUp();
}

/**
 * Call after a fresh upload replaces a variant's stored weight file
 * (Settings' upload control, via modelStorage.ts) — the cached
 * GemmaEdgeModel instance may already hold an inference session built from
 * the old bytes, which this drops so the next prepareModel()/summarizeRoom()
 * call picks up what was just uploaded.
 */
export function resetLocalModel(modelId: GemmaModelId): void {
  localModelCache.get(modelId)?.invalidate();
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('Gemini mode is selected but no API key is set — add one in Settings.');
    this.name = 'MissingApiKeyError';
  }
}

export async function summarizeRoom(
  roomName: string,
  messages: UnreadMessage[],
  settings: Pick<ChatSummarySettings, 'mode' | 'localModel' | 'geminiModel' | 'instruction'>,
  geminiApiKey: string,
): Promise<string> {
  const model =
    settings.mode === 'local'
      ? getLocalModel(settings.localModel)
      : (() => {
          if (!geminiApiKey) throw new MissingApiKeyError();
          return createGeminiModel(geminiApiKey, settings.geminiModel);
        })();

  const agent = new Agent({
    name: 'chat-summary',
    model,
    systemPrompt: settings.instruction,
  });
  attachTraceLogging(agent, `summarize:${roomName}`);

  const transcript = messages.map((m) => `${m.sender}: ${m.body}`).join('\n');
  const result = await agent.invoke(`Room: ${roomName}\n\nUnread messages:\n${transcript}`);
  return result.toString().trim();
}
