import {
  Model,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  JsonBlock,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
  type StopReason,
  type ToolSpec,
} from '@strands-agents/sdk';
import {
  Engine,
  type Conversation,
  type Message as LmMessage,
  type ContentPart as LmContentPart,
  type Tool as LmTool,
  type Schema as LmSchema,
  type ToolCall as LmToolCall,
  type ToolResponsePart as LmToolResponsePart,
  type JsonValue as LmJsonValue,
} from '@litert-lm/core';
import { getStoredModelFile } from './modelStorage';

/**
 * The LiteRT-LM JS runtime (`@litert-lm/core`) currently only knows how to
 * load a small, explicit allowlist of web-packaged `.litertlm` files — NOT
 * arbitrary `.litertlm` files in general (that's coming later per upstream,
 * but isn't here yet). As of this runtime version that allowlist is exactly
 * these two, both published under the `litert-community` org:
 *  - `gemma-4-E2B-it-web.litertlm` from `litert-community/gemma-4-E2B-it-litert-lm`
 *  - `gemma-4-E4B-it-web.litertlm` from `litert-community/gemma-4-E4B-it-litert-lm`
 * Any other `.litertlm` — including a gemma-3n build, or a non-`-web`
 * packaging of these same models — fails to load, typically surfacing as
 * `Invalid magic number. Expected 'LITERTLM', got '...'` even though the
 * file itself may be a perfectly valid LiteRT-LM container.
 */
export type GemmaModelId = 'gemma-4-e2b' | 'gemma-4-e4b';

export interface GemmaModelConfig extends BaseModelConfig {
  modelId?: GemmaModelId;
}

/**
 * Default total context budget (input + output tokens together) handed to
 * `mainExecutorSettings.maxNumTokens` below when `config.maxTokens` isn't
 * set — which is always, currently; nothing in this app overrides it yet.
 * Previously 1024, a MediaPipe-era leftover nobody revisited after the
 * LiteRT-LM migration: far too small for real usage (surfaces as the
 * runtime's own "Input token ids are too long" error the moment a room's
 * unread backlog — or a chat history — pushes past it, e.g. a single busy
 * day easily runs ~2000+ tokens). 8192 matches the value LiteRT-LM's own
 * quickstart (`@litert-lm/core`'s README) uses. Exported so summarize.ts
 * can size its own transcript-truncation safety net against the same
 * number rather than duplicating a hardcoded budget.
 */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Fallback location for each variant's weight file if the user hasn't
 * uploaded their own copy (see modelStorage.ts) — only reachable if you
 * choose to still bake `.litertlm` files into `public/models/` yourself
 * (see that dir's README). Uploading your own copy in Settings is the
 * primary path now; this exists so an image that DOES bundle a file still
 * works without every user having to re-upload it.
 */
const MODEL_ASSET_PATHS: Record<GemmaModelId, string> = {
  'gemma-4-e2b': '/models/gemma-4-E2B-it-web.litertlm',
  'gemma-4-e4b': '/models/gemma-4-E4B-it-web.litertlm',
};

export const GEMMA_MODEL_OPTIONS: { id: GemmaModelId; label: string; note: string }[] = [
  { id: 'gemma-4-e2b', label: 'Gemma 4 E2B (fast)', note: 'Smaller download, quicker summaries, lower quality.' },
  { id: 'gemma-4-e4b', label: 'Gemma 4 E4B (quality)', note: 'Larger download, slower, better summaries.' },
];

/**
 * Strands `Model` implementation backed by Google's LiteRT-LM Web runtime
 * (`@litert-lm/core`), running a quantized Gemma model entirely inside this
 * widget's iframe via WebGPU. Per-invocation there is no network call at
 * all — only the one-time model asset fetch (weights, not message content)
 * the first time a given variant is used.
 *
 * Replaces the earlier MediaPipe `LlmInference`-based implementation. Two
 * things LiteRT-LM's `Engine`/`Conversation` API gets natively that MediaPipe
 * didn't, both used below:
 *  - A `preface` on `createConversation` for system prompt + prior turns
 *    (including tool declarations, via `preface.tools`), instead of
 *    hand-concatenating one big prompt string.
 *  - `sendMessageStreaming()` returns an async-iterable `ReadableStream` of
 *    delta chunks directly — no callback-to-generator bridge needed (compare
 *    the old `streamGemmaText`'s pending-queue dance for MediaPipe's
 *    callback-based `generateResponse`).
 * A `Conversation` is created fresh per `stream()` call (and deleted in a
 * `finally`) rather than reused, since the `messages` array Strands passes
 * in is the full history every time, not just what's new — see `toLmMessage`
 * below. This does mean `config.temperature` (set per-`Conversation` via
 * `sessionConfig.samplerParams`) now actually takes effect on every call,
 * unlike the old code where it was baked into the cached `LlmInference` at
 * first use and silent thereafter.
 *
 * Tool-calling: `stream()` translates `options.toolSpecs` into
 * `preface.tools` and translates the runtime's own `Message.tool_calls`
 * (see `conversation_config.ts`) into Strands' `toolUseStart`/
 * `toolUseInputDelta` event pair — the exact protocol reverse-engineered
 * from `@strands-agents/sdk`'s own `GoogleModel` (models/google/adapters.ts),
 * since that's the one other provider in this codebase that has to do the
 * same translation. Deliberately NOT using `@litert-lm/core`'s own
 * `AutoToolChat` orchestrator — Strands' `Agent`/`tool-caller.ts` already
 * runs the call-tool-then-resume-model loop generically across providers
 * (including the `send_message` approval interrupt in tools.ts), so
 * layering AutoToolChat's *own* loop underneath would just be two loops
 * fighting over the same job. `options.toolChoice` (force a specific tool)
 * has no equivalent in this runtime version and is silently ignored — the
 * model always decides for itself.
 *
 * IMPORTANT for whoever bumps this dependency: `@litert-lm/core@0.16.0` (npm
 * `latest` as of this writing) is a broken publish — its tarball contains
 * only `package.json`, no `dist/`. `0.15.0` is the last version with a real
 * build. package.json pins the exact version (no `^`) for exactly this
 * reason — verify a version's tarball actually contains `dist/index.js`
 * (`npm pack @litert-lm/core@<version> -O -` | tar tz) before bumping.
 *
 * Event shapes below were verified against @strands-agents/sdk's actual
 * .d.ts output (dist/src/models/streaming.d.ts), not just strandsagents.com
 * docs — same "verify against the live install" discipline the
 * nordeck-widget skill calls out for unstable Matrix event names.
 */
export class GemmaEdgeModel extends Model<GemmaModelConfig> {
  private config: GemmaModelConfig;
  private enginePromise?: Promise<Engine>;

  constructor(config: GemmaModelConfig = {}) {
    super();
    this.config = { modelId: 'gemma-4-e2b', ...config };
  }

  updateConfig(modelConfig: GemmaModelConfig): void {
    const modelChanged =
      modelConfig.modelId !== undefined && modelConfig.modelId !== this.config.modelId;
    this.config = { ...this.config, ...modelConfig };
    if (modelChanged) {
      // Force re-init against the new variant's weight file on next use.
      this.invalidate();
    }
  }

  getConfig(): GemmaModelConfig {
    return this.config;
  }

  /** Eagerly triggers model load, so Settings can show real "preparing" state before the user hits Sync. */
  async warmUp(): Promise<void> {
    await this.getEngine();
  }

  /** Drops the cached engine (freeing its WASM/GPU resources) so the next call re-checks storage — call after a fresh upload replaces this variant's file. */
  invalidate(): void {
    const prior = this.enginePromise;
    this.enginePromise = undefined;
    prior?.then((engine) => engine.delete()).catch(() => {
      // Already gone, or never finished loading — nothing to clean up.
    });
  }

  private getEngine(): Promise<Engine> {
    if (!this.enginePromise) {
      const modelId = this.config.modelId ?? 'gemma-4-e2b';
      this.enginePromise = (async () => {
        // Prefer a user-uploaded copy (modelStorage.ts, OPFS) over the
        // bundled path — see that module's comment for why: keeps the
        // Docker image small instead of baking multi-GB weight files into
        // every build. Falls back to the bundled path only if nothing's
        // been uploaded, so an image that DOES still bundle one keeps
        // working without forcing a re-upload.
        const uploaded = await getStoredModelFile(modelId);
        return Engine.create({
          model: uploaded ?? MODEL_ASSET_PATHS[modelId],
          // Total context budget (input + output), same role this played
          // against MediaPipe's LlmInference `maxTokens` baseOption.
          mainExecutorSettings: { maxNumTokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS },
        });
        // Backend defaults to GPU_ARTISAN (WebGPU) when unspecified, and
        // the WASM runtime itself lazy-loads from LiteRT-LM's own
        // version-pinned jsdelivr default — no FilesetResolver/WASM_BASE
        // equivalent to configure here.
      })().catch((err) => {
        // Don't cache a rejected promise forever — let the next call retry.
        this.enginePromise = undefined;
        throw err;
      });
    }
    return this.enginePromise;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const engine = await this.getEngine();

    // Tool-use ids are minted by *us* (the runtime's tool_calls don't always
    // carry one — see toolCallFromLm below) when we first emit a call, so
    // this map is self-referential: it only ever needs to resolve ids this
    // same class handed out on an earlier turn in this same conversation.
    const toolUseIdToName = new Map<string, string>();
    for (const message of messages) {
      for (const block of message.content) {
        if (block instanceof ToolUseBlock) toolUseIdToName.set(block.toolUseId, block.name);
      }
    }

    const historyMessages = messages.slice(0, -1).map((m) => toLmMessage(m, toolUseIdToName));
    const systemText = extractSystemText(options?.systemPrompt);
    const prefaceMessages: LmMessage[] = [];
    if (systemText) prefaceMessages.push({ role: 'system', content: systemText });
    prefaceMessages.push(...historyMessages);

    // NOTE on `Failed to apply template: undefined value (in template:NN)`:
    // this is NOT caused by the shape of what we send — reverted an earlier
    // attempt at a fix here that assumed a lone `role: 'system'` preface
    // message (no history after it, true on every conversation's first
    // turn) was the trigger; it wasn't; the crash reproduces identically
    // with or without a system message at all. It's a confirmed upstream
    // bug: LiteRT-LM's on-device template engine (an early-preview,
    // deliberately minimal Jinja-like interpreter running inside the WASM
    // binary) can't evaluate constructs Gemma 4's *official* chat template
    // uses — reported for this exact model/error at
    // https://github.com/google-ai-edge/LiteRT-LM/issues/2078 (still open,
    // no fix as of this writing). The only workaround documented there is
    // bypassing template application entirely via the low-level
    // Session.runPrefill/runDecode API with a hand-formatted prompt string
    // instead of Conversation — a real rewrite (loses this class's
    // streaming and tool-calling translation both), not a one-line patch,
    // so not done here without deciding that trade-off is worth it first.
    const conversation = await engine.createConversation({
      preface: {
        ...(prefaceMessages.length > 0 && { messages: prefaceMessages }),
        ...(options?.toolSpecs && options.toolSpecs.length > 0 && { tools: options.toolSpecs.map(toolSpecToLm) }),
      },
      sessionConfig:
        this.config.temperature !== undefined
          ? { samplerParams: { temperature: this.config.temperature } }
          : undefined,
    });

    try {
      yield { type: 'modelMessageStartEvent', role: 'assistant' };

      const lastMessage: LmMessage | string =
        messages.length > 0 ? toLmMessage(messages[messages.length - 1], toolUseIdToName) : '';

      let textBlockOpen = false;
      let hasToolCalls = false;
      let full = '';

      for await (const chunk of conversation.sendMessageStreaming(lastMessage)) {
        for (const text of textPartsOf(chunk.content)) {
          if (!textBlockOpen) {
            yield { type: 'modelContentBlockStartEvent' };
            textBlockOpen = true;
          }
          full += text;
          yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text } };
        }

        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          if (textBlockOpen) {
            yield { type: 'modelContentBlockStopEvent' };
            textBlockOpen = false;
          }
          for (const call of chunk.tool_calls) {
            hasToolCalls = true;
            const { toolUseId, name, input } = toolCallFromLm(call);
            toolUseIdToName.set(toolUseId, name);
            yield {
              type: 'modelContentBlockStartEvent',
              start: { type: 'toolUseStart', name, toolUseId },
            };
            yield {
              type: 'modelContentBlockDeltaEvent',
              delta: { type: 'toolUseInputDelta', input: JSON.stringify(input) },
            };
            yield { type: 'modelContentBlockStopEvent' };
          }
        }
      }

      if (textBlockOpen) {
        yield { type: 'modelContentBlockStopEvent' };
      }

      const stopReason: StopReason = hasToolCalls ? 'toolUse' : 'endTurn';
      yield { type: 'modelMessageStopEvent', stopReason };

      // Gemma runs with no server-side token accounting, so this is the
      // base class's char-count heuristic on both sides — good enough for the
      // context-window estimate this feeds, not meant to be exact.
      const inputTokens = await this.countTokens(messages, {
        systemPrompt: options?.systemPrompt,
        toolSpecs: options?.toolSpecs,
      });
      const outputTokens = Math.max(1, Math.ceil(full.length / 4));
      yield {
        type: 'modelMetadataEvent',
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    } finally {
      // One Conversation per stream() call (see class doc for why) — clean
      // it up so repeated calls don't pile up WASM-side conversation state.
      await conversation.delete().catch(() => {});
    }
  }
}

/** Text parts of a chunk/message's `content` — `content` is either a plain string or a `ContentPart[]` (see conversation_config.ts); only `type: 'text'` parts matter since this widget is text-in/text-out only (images/audio/video aren't implemented in the JS runtime yet either). */
function textPartsOf(content: string | LmContentPart[] | undefined): string[] {
  if (!content) return [];
  if (typeof content === 'string') return content ? [content] : [];
  const out: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) out.push(part.text);
  }
  return out;
}

/**
 * `spec.inputSchema` is a full JSON Schema (draft 7); the runtime's own
 * `Schema` type only understands a small subset (type/description/
 * properties/required/items/enum — see `Schema` in conversation_config.ts).
 * Passed through as-is rather than stripped down to that subset: the C++
 * runtime is the one that has to tolerate (or ignore) whatever extra
 * JSON-Schema keywords a tool's zod schema happens to produce, same as it
 * already has to for any other JS caller.
 *
 * Wrapped in `{ type: 'function', function: {...} }` rather than sent as a
 * bare `FunctionDeclaration` — `Tool`'s doc comment claims the runtime
 * "accepts both wrapped and unwrapped formats", but Gemma 4's own chat
 * template (verified against the actual published
 * `litert-community/gemma-4-*-it-litert-lm` `chat_template.jinja`, identical
 * for both E2B and E4B) only implements the wrapped one:
 * `format_function_declaration` indexes `tool_data['function']['name']`
 * unconditionally. Sending the bare shape means `tool_data['function']` is
 * undefined, and `['name']` on that is exactly what threw `Failed to apply
 * template: undefined value` (that macro's first line) the moment any tool
 * declarations were in play — i.e. every Chat-tab call in local mode, since
 * that's the one Agent built with `tools:` (chatAgent.ts); summarize.ts's
 * Agent has none, so it never hit this particular path.
 */
function toolSpecToLm(spec: ToolSpec): LmTool {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.inputSchema as unknown as LmSchema | undefined,
    },
  };
}

/**
 * The runtime's own `ToolCall.function.arguments` is already a parsed
 * `Record<string, JsonValue>` (not an incremental JSON string, unlike
 * Gemini/Anthropic-style deltas — see auto_tool_chat.js, which concatenates
 * whole `tool_calls` arrays across chunks rather than assembling partial
 * JSON), so there's exactly one `toolUseInputDelta` per call, not several.
 * `id` is optional on the wire; mint one when absent, same as the Google
 * adapter does for Gemini (`tooluse_${crypto.randomUUID()}`).
 */
function toolCallFromLm(call: LmToolCall): { toolUseId: string; name: string; input: LmJsonValue } {
  return {
    toolUseId: call.id || `tooluse_${crypto.randomUUID()}`,
    name: call.function.name,
    input: call.function.arguments,
  };
}

/**
 * Strands passes the FULL conversation on every `stream()` call, not just
 * what's new — see the class doc's note on per-call `Conversation`s. This
 * mirrors `formatContentBlock`/`formatToolUseBlock`/`formatToolResultBlock`
 * in `@strands-agents/sdk`'s Google adapter, but targets the runtime's own
 * message shape instead of Gemini's `Content`/`Part`:
 *  - An assistant turn's `ToolUseBlock`s become `tool_calls` (the runtime's
 *    own field for a past tool-calling turn), alongside any text content.
 *  - A user turn's `ToolResultBlock`s get sent back as `role: 'tool'` with
 *    `tool_response` content parts — the same shape `AutoToolChat` itself
 *    feeds back after running a tool (see auto_tool_chat.js), so this is
 *    "do what the runtime's own loop would have done," just driven by
 *    Strands' `tool-caller.ts` instead of `AutoToolChat`.
 */
function toLmMessage(message: Message, toolUseIdToName: Map<string, string>): LmMessage {
  const text = textOf(message);
  const toolUseBlocks = message.content.filter((b): b is ToolUseBlock => b instanceof ToolUseBlock);
  const toolResultBlocks = message.content.filter((b): b is ToolResultBlock => b instanceof ToolResultBlock);

  if (toolResultBlocks.length > 0) {
    const content: LmContentPart[] = [];
    if (text) content.push({ type: 'text', text });
    for (const block of toolResultBlocks) {
      content.push(toolResultToLm(block, toolUseIdToName));
    }
    return { role: 'tool', content };
  }

  const lm: LmMessage = { role: message.role, ...(text && { content: text }) };
  if (toolUseBlocks.length > 0) {
    lm.tool_calls = toolUseBlocks.map((block) => ({
      type: 'function',
      id: block.toolUseId,
      function: { name: block.name, arguments: toJsonRecord(block.input) },
    }));
  }
  return lm;
}

/** `ToolUseBlock.input` is typed `JSONValue` on the Strands side but the runtime wants a plain object — every tool in tools.ts declares an object inputSchema, so this should always already be one; the fallback just avoids crashing on a stray non-object input instead of silently mis-typing it. */
function toJsonRecord(input: unknown): Record<string, LmJsonValue> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, LmJsonValue>) : {};
}

/**
 * `ToolResponsePart.name` correlates back to the *tool's name*, not the
 * `toolUseId` — matching `auto_tool_chat.js`'s own
 * `{ type: 'tool_response', name: tc.function.name, response }`, since
 * `ToolResponsePart` has no id field to correlate by. `toolUseIdToName` is
 * built from every `ToolUseBlock` seen across the whole `messages` array
 * (same approach as the Google adapter's `toolUseIdToName`), so this
 * resolves even when the result message doesn't carry its own call.
 */
function toolResultToLm(block: ToolResultBlock, toolUseIdToName: Map<string, string>): LmToolResponsePart {
  const texts = block.content.filter((c): c is TextBlock => c instanceof TextBlock).map((c) => c.text);
  const jsonParts = block.content.filter((c): c is JsonBlock => c instanceof JsonBlock).map((c) => c.json);
  const response: LmJsonValue =
    jsonParts.length === 1 && texts.length === 0
      ? jsonParts[0]
      : { status: block.status, output: [...texts, ...jsonParts] };
  return {
    type: 'tool_response',
    name: toolUseIdToName.get(block.toolUseId) ?? block.toolUseId,
    response,
  };
}

function textOf(message: Message): string {
  return message.content
    .filter((block): block is TextBlock => block.type === 'textBlock')
    .map((block) => block.text)
    .join('\n');
}

function extractSystemText(systemPrompt?: StreamOptions['systemPrompt']): string {
  if (!systemPrompt) return '';
  if (typeof systemPrompt === 'string') return systemPrompt;
  return systemPrompt
    .filter((block): block is TextBlock => block.type === 'textBlock')
    .map((block) => block.text)
    .join('\n');
}
