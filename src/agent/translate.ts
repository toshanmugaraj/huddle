import { Agent } from '@strands-agents/sdk';
import { getLocalModel, MissingApiKeyError } from './summarize';
import { createGeminiModel } from '../model/geminiModel';
import { attachTraceLogging } from './trace';
import type { HuddleSettings } from '../matrix/settingsSync';
import type { RoomMessage } from '../matrix/messages';

/**
 * On-request translation for TopicMessagesDialog's citation previews —
 * deliberately separate from summarize.ts's structured-output path rather
 * than folded into it (e.g. as an extra per-message field on
 * SummaryTopicSchema). Two reasons:
 *  - It only ever needs to run for the handful of messages actually shown
 *    in one dialog (typically well under 10), not every message in the
 *    synced range — doing it inside summarizeRoom would mean translating
 *    messages nobody ends up viewing.
 *  - Plain text in, plain text out — no Zod schema, no structuredOutputSchema,
 *    on purpose. This session's whole fight with GemmaEdgeModel and
 *    structured output (see summarize.ts's git history) was about a small
 *    on-device model unreliably producing valid nested JSON; a translation
 *    task doesn't need JSON at all, so it isn't worth that risk just to
 *    reuse machinery built for a different problem.
 *
 * Manual, not automatic (confirmed with the user): translation is a real,
 * separate model call — for local mode specifically, one more multi-second
 * wait a user didn't ask for just by opening a dialog. TopicMessagesDialog
 * only calls this from an explicit "Translate" button.
 */
export async function translateMessages(
  messages: RoomMessage[],
  language: string,
  settings: Pick<HuddleSettings, 'mode' | 'localModel' | 'geminiModel'>,
  geminiApiKey: string,
): Promise<string[]> {
  const model =
    settings.mode === 'local'
      ? getLocalModel(settings.localModel)
      : (() => {
          if (!geminiApiKey) throw new MissingApiKeyError();
          return createGeminiModel(geminiApiKey, settings.geminiModel);
        })();

  const agent = new Agent({
    name: 'huddle-translate',
    model,
    systemPrompt:
      `You are a translator. Each message below is prefixed with a bracketed index like "[3]". ` +
      `Translate every message into ${language}. If a message is already in ${language}, return it ` +
      `unchanged. Respond with exactly one translation per message, each starting with that same ` +
      `"[N]" tag on its own line — a translation may itself span multiple lines; keep any continuation ` +
      `lines un-prefixed, they still belong to the most recent "[N]". Output nothing else: no preamble, ` +
      `no explanation, no extra commentary.`,
  });
  attachTraceLogging(agent, 'translate');

  const prompt = messages.map((m, i) => `[${i + 1}] ${m.body}`).join('\n');
  const result = await agent.invoke(prompt);
  return parseTranslations(result.toString(), messages.length);
}

/**
 * Parses the "[N] text..." format translateMessages asks for, tolerant of
 * a model dropping or reordering entries (returns '' for any index it
 * didn't find — caller treats that as "translation unavailable for this
 * one" rather than failing the whole batch) and of multi-line
 * translations (everything up to the next "[N]" marker, or end of text,
 * belongs to the current one). Exported for direct testing — this parsing
 * logic, not the Agent plumbing around it, is the real risk surface (a
 * real model's raw text output).
 */
export function parseTranslations(text: string, expectedCount: number): string[] {
  const markers = [...text.matchAll(/^\[(\d+)\]\s*/gm)];
  const byIndex = new Map<number, string>();
  for (let i = 0; i < markers.length; i++) {
    const n = Number(markers[i][1]);
    const start = markers[i].index! + markers[i][0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index! : text.length;
    byIndex.set(n, text.slice(start, end).trim());
  }
  return Array.from({ length: expectedCount }, (_, i) => byIndex.get(i + 1) ?? '');
}
