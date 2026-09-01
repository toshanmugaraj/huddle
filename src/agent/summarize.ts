import { Agent } from '@strands-agents/sdk';
import { DEFAULT_MAX_TOKENS, GemmaEdgeModel, type GemmaModelId } from '../model/GemmaEdgeModel';
import { createGeminiModel, type GeminiModelId } from '../model/geminiModel';
import type { HuddleSettings } from '../matrix/settingsSync';
import type { RoomMessage } from '../matrix/messages';
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
  messages: RoomMessage[],
  settings: Pick<HuddleSettings, 'mode' | 'localModel' | 'geminiModel' | 'instruction'>,
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
    name: 'huddle-summarize',
    model,
    systemPrompt: settings.instruction,
  });
  attachTraceLogging(agent, `summarize:${roomName}`);

  // Only local mode has a fixed, client-side context budget to worry about
  // (GemmaEdgeModel's maxNumTokens, input+output shared — see
  // DEFAULT_MAX_TOKENS) — Gemini's is server-side and far larger, not a
  // realistic concern for one room's worth of a day's messages. A
  // genuinely busy day can still blow past even the 8192 default outright
  // (surfaced as the runtime's own "Input token ids are too long" error),
  // so trim to the most recent messages that fit rather than let that
  // happen.
  const transcript =
    settings.mode === 'local' ? buildTruncatedTranscript(messages) : buildTranscript(messages);
  // Neither model has real-world clock access (Gemma runs fully offline;
  // Gemini isn't told the date either), so an instruction asking for a
  // "Date" field has nothing to go on but a guess unless it's handed the
  // actual date here — same local-calendar-day boundary getTodayMessages
  // uses, not toISOString()'s UTC date, which can be a day off near
  // midnight in most timezones.
  const result = await agent.invoke(
    `Date: ${todayDateLabel()}\nRoom: ${roomName}\n\nMessages from today:\n${transcript}`,
  );
  return result.toString().trim();
}

function todayDateLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildTranscript(messages: RoomMessage[]): string {
  return messages.map((m) => `${m.sender}: ${m.body}`).join('\n');
}

// Rough chars-per-token estimate — same order of magnitude GemmaEdgeModel
// itself uses for its own usage accounting (char-count / 4). Doesn't need to
// be exact, just needs to land comfortably under the real cutoff.
const CHARS_PER_TOKEN_ESTIMATE = 4;
// Headroom left for the system instruction, the "Date: ...\nRoom:
// ...\n\nMessages from today:\n" wrapper, and the model's own reply — all
// of which share the same budget as the transcript.
const RESERVED_TOKENS = 1024;

function buildTruncatedTranscript(messages: RoomMessage[]): string {
  const budgetChars = Math.max(0, DEFAULT_MAX_TOKENS - RESERVED_TOKENS) * CHARS_PER_TOKEN_ESTIMATE;
  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `${messages[i].sender}: ${messages[i].body}`;
    if (used + line.length + 1 > budgetChars) {
      omitted = i + 1;
      break;
    }
    kept.unshift(line);
    used += line.length + 1;
  }
  if (omitted === 0) return kept.join('\n');
  return `[${omitted} earlier message(s) omitted — too long for local mode's context window]\n${kept.join('\n')}`;
}
