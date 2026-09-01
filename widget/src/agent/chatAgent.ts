import { Agent } from '@strands-agents/sdk';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { createGeminiModel, type GeminiModelId } from '../model/geminiModel';
import { getLocalModel } from './summarize';
import type { GemmaModelId } from '../model/GemmaEdgeModel';
import { buildChatTools } from './tools';
import { attachTraceLogging } from './trace';

export type ChatAgentKey =
  | { mode: 'gemini'; apiKey: string; modelId: GeminiModelId }
  | { mode: 'local'; modelId: GemmaModelId };

function sameKey(a: ChatAgentKey, b: ChatAgentKey): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'gemini' && b.mode === 'gemini') return a.apiKey === b.apiKey && a.modelId === b.modelId;
  if (a.mode === 'local' && b.mode === 'local') return a.modelId === b.modelId;
  return false;
}

/**
 * The interactive chat agent — distinct from summarize.ts's one-shot
 * per-room Agent in two ways that both matter:
 *
 * 1. It's given tools (get_room_messages / navigate_to_room / send_message),
 *    which both providers now support: Gemini via its native function
 *    calling, and GemmaEdgeModel by translating LiteRT-LM's own tool-calling
 *    protocol into the same Strands event stream (see that file's class
 *    doc). Local mode reuses summarize.ts's cached GemmaEdgeModel instance
 *    rather than loading the model a second time.
 * 2. It's a SINGLE PERSISTENT instance for the chat session, not rebuilt
 *    per call. This isn't just an optimization: a send_message approval
 *    interrupt pauses execution via `context.interrupt()`, and resuming it
 *    requires calling `.invoke()` again on that exact same Agent instance
 *    (its interrupt state lives on the agent object) — a fresh Agent
 *    wouldn't know what it was resuming.
 */
let cached: { key: ChatAgentKey; agent: Agent } | undefined;

export function getChatAgent(widgetApi: WidgetApi, key: ChatAgentKey): Agent {
  if (cached && sameKey(cached.key, key)) {
    return cached.agent;
  }

  const model = key.mode === 'gemini' ? createGeminiModel(key.apiKey, key.modelId) : getLocalModel(key.modelId);

  const agent = new Agent({
    name: 'chat-summary-assistant',
    model,
    tools: buildChatTools(widgetApi),
    systemPrompt:
      'You are a helpful assistant embedded in a Matrix chat widget. You can read recent room ' +
      'messages, navigate the user to a room, and send a message on their behalf (send_message ' +
      'always pauses for the user to approve the exact text before anything is actually sent). ' +
      'Keep replies concise.',
  });

  attachTraceLogging(agent, 'chat');
  cached = { key, agent };
  return agent;
}

/** Call when the user changes rooms/settings in a way that should start a fresh conversation, or explicitly resets the chat. */
export function resetChatAgent(): void {
  cached = undefined;
}
