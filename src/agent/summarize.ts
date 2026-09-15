import { Agent } from '@strands-agents/sdk';
import { z } from 'zod';
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

/**
 * Output shape for summarizeRoom, enforced via Strands' structuredOutputSchema
 * (a Zod schema converted to a forced tool call — see summarizeRoom's own
 * comment) rather than by asking the model to produce a particular prose/
 * Markdown format, which is what this app used to do (see git history: a
 * "[[msgs: ...]]" marker embedded in free-text Markdown, parsed back out
 * with marked's lexer — this schema replaces that entirely).
 *
 * `.describe()` text on each field IS the model's real instruction for what
 * to put there — it becomes part of the tool's JSON schema description the
 * model sees, the same mechanism agent/tools.ts's own tool `inputSchema`s
 * already rely on for tool-calling.
 */
const SummaryTopicSchema = z.object({
  title: z.string().describe('A short label for this topic or theme, e.g. "Element X iOS Native EC Timeline".'),
  points: z
    .array(z.string())
    .describe(
      'One or more specific observations, decisions, or facts about this topic — each as a single plain-text sentence, no Markdown formatting.',
    ),
  messageIndices: z
    .array(z.number().int())
    .describe(
      'The indices (matching each message\'s leading "[N]" tag in the transcript below) of every message this topic and its points draw on. Use an empty array when this topic cannot be clearly attributed to specific messages — never guess.',
    ),
});

const RoomSummarySchema = z.object({
  topics: z
    .array(SummaryTopicSchema)
    .describe(
      'One entry per distinct topic or theme discussed in the given messages, grouped thematically rather than chronologically. Do not create an entry for off-topic banter, jokes, or ambient greetings.',
    ),
});

export type SummaryTopic = z.infer<typeof SummaryTopicSchema>;

export class MissingApiKeyError extends Error {
  constructor() {
    super('Gemini mode is selected but no API key is set — add one in Settings.');
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Appended to whatever settings.instruction currently is (see
 * summarizeRoom below) — never baked into DEFAULT_SETTINGS.instruction,
 * for the same reason the old CITATION_INSTRUCTION was appended this way
 * rather than edited into the default: settings.instruction is free text
 * the user can (and does) customize in Settings, so a structural, always-
 * on behavior like this has to be layered on at the Agent-construction
 * site to survive an already-saved custom instruction. Empty string when
 * `language` is '' (Settings' "Auto" option) — the common case, and
 * deliberately a no-op rather than an explicit "write in whatever
 * language the messages are in" instruction, since that's already the
 * model's natural default with nothing said about it either way.
 */
function languageInstruction(language: string): string {
  if (!language) return '';
  return `\n\nWrite your entire response — every topic's title and points — in ${language}, regardless of what language the messages themselves are in. Translate rather than leaving anything in its original language.`;
}

export async function summarizeRoom(
  roomName: string,
  messages: RoomMessage[],
  settings: Pick<HuddleSettings, 'mode' | 'localModel' | 'geminiModel' | 'instruction' | 'language'>,
  geminiApiKey: string,
  /**
   * Same meaning as HuddleSettings.historyDaysBack — 0 (the default) is
   * "today", N extends the range to include the N previous calendar days
   * too. Only used to build the "Messages from" label below; the actual
   * filtering already happened in messages.ts's getMessagesSince before
   * `messages` reached this function.
   */
  daysBack = 0,
): Promise<SummaryTopic[]> {
  const model =
    settings.mode === 'local'
      ? getLocalModel(settings.localModel)
      : (() => {
          if (!geminiApiKey) throw new MissingApiKeyError();
          return createGeminiModel(geminiApiKey, settings.geminiModel);
        })();

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
  // Gemini isn't told the date either) — the actual date/range isn't part
  // of the schema (it's already known client-side from `daysBack`; no need
  // to ask the model to echo it back), but it's still worth giving the
  // model for context on how much history it's looking at.
  const prompt = `Room: ${roomName}\n\nMessages from ${messagesFromLabel(daysBack)}:\n${transcript}`;

  const systemPrompt = `${settings.instruction}${languageInstruction(settings.language)}`;

  const agent = new Agent({
    name: 'huddle-summarize',
    model,
    systemPrompt,
    structuredOutputSchema: RoomSummarySchema,
  });
  attachTraceLogging(agent, `summarize:${roomName}`);

  try {
    const result = await agent.invoke(prompt);
    // Strands has already validated this against RoomSummarySchema by the
    // time invoke() resolves (via the forced structured-output tool call
    // — see this function's own doc comment on structuredOutputSchema);
    // if it couldn't get a valid call out of the model at all, invoke()
    // rejects instead of resolving with something to cast here.
    return (result.structuredOutput as z.infer<typeof RoomSummarySchema>).topics;
  } catch {
    // Local mode can fail structured output in more than one shape — Gemma
    // simply not calling the tool even after GemmaEdgeModel's forced-pass
    // nudge (Strands' own StructuredOutputError), or calling it with
    // output its own function-calling grammar then rejects as malformed
    // (a plain Error surfacing from deep inside @litert-lm/core — a real,
    // user-reported example: a generated tool call with a mismatched
    // closing bracket, rejected by LiteRT-LM's parser with "Failed to
    // parse FC tool calls: ..."). Catching unconditionally here, not just
    // StructuredOutputError, covers both without needing to keep
    // enumerating every shape a local-mode failure can take. Safe to do
    // for any mode, not just local: if the fallback invoke below ALSO
    // fails, that failure just propagates normally from here — nothing
    // gets silently swallowed, this just tries one more reasonable thing
    // first. Falls back to one plain, schema-free invoke and surfaces it
    // as a single, uncited topic — same "no citation → plain text, no
    // chip" rendering SummaryCard already has for a topic the model
    // simply couldn't attribute to specific messages, no new UI needed.
    const fallbackAgent = new Agent({ name: 'huddle-summarize-fallback', model, systemPrompt });
    attachTraceLogging(fallbackAgent, `summarize-fallback:${roomName}`);
    const text = (await fallbackAgent.invoke(prompt)).toString().trim();
    const points = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return [
      {
        title: 'Summary',
        points: points.length > 0 ? points : ['(The model did not return a usable response.)'],
        messageIndices: [],
      },
    ];
  }
}

function dateLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2024-06-15", or "2024-06-13 to 2024-06-15" once daysBack pulls in prior days too — exported for Home.tsx's summary-card caption, computed client-side rather than asked of the model (nothing to get wrong or omit). */
export function dateRangeLabel(daysBack: number): string {
  const today = new Date();
  if (daysBack <= 0) return dateLabel(today);
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack);
  return `${dateLabel(start)} to ${dateLabel(today)}`;
}

/** "today", or "the last N days" once daysBack pulls in prior days too — feeds the transcript's "Messages from ...:" header. */
function messagesFromLabel(daysBack: number): string {
  return daysBack <= 0 ? 'today' : `the last ${daysBack + 1} days`;
}

// Exported so tests can assert the "[N]" indices these produce line up with
// the ORIGINAL messages array position (1-based) — that's what a topic's
// messageIndices (see SummaryTopicSchema above) is resolved against in
// sync.ts to get back to a real RoomMessage/eventId.
export function buildTranscript(messages: RoomMessage[]): string {
  return messages.map((m, i) => `[${i + 1}] ${m.sender}: ${m.body}`).join('\n');
}

// Rough chars-per-token estimate — same order of magnitude GemmaEdgeModel
// itself uses for its own usage accounting (char-count / 4). Doesn't need to
// be exact, just needs to land comfortably under the real cutoff.
const CHARS_PER_TOKEN_ESTIMATE = 4;
// Headroom left for the system instruction, the "Room: ...\n\nMessages from
// today:\n" wrapper, and the model's own reply — all of which share the
// same budget as the transcript.
const RESERVED_TOKENS = 1024;

export function buildTruncatedTranscript(messages: RoomMessage[]): string {
  const budgetChars = Math.max(0, DEFAULT_MAX_TOKENS - RESERVED_TOKENS) * CHARS_PER_TOKEN_ESTIMATE;
  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    // `i + 1` here is each message's ORIGINAL position in `messages`, not
    // its position within `kept` (which only fills in backwards as this
    // loop runs) — that's what keeps a messageIndices entry recoverable via
    // `messages[i - 1].eventId` regardless of how much got truncated below.
    const line = `[${i + 1}] ${messages[i].sender}: ${messages[i].body}`;
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
