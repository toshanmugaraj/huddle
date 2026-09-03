import { Agent } from '@strands-agents/sdk';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { createGeminiModel, type GeminiModelId } from '../model/geminiModel';
import { getLocalModel } from './summarize';
import type { GemmaModelId } from '../model/GemmaEdgeModel';
import { buildChatTools } from './tools';
import { attachTraceLogging } from './trace';
import type { SelectedRoom } from '../state/chatStore';

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
 * 1. It's given tools (list_rooms / get_room_id_by_name / set_selected_room /
 *    get_room_messages / navigate_to_room / send_message),
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

export function getChatAgent(
  widgetApi: WidgetApi,
  key: ChatAgentKey,
  userId: string,
  onSelectRoom: (room: SelectedRoom) => void,
): Agent {
  if (cached && sameKey(cached.key, key)) {
    return cached.agent;
  }

  const model = key.mode === 'gemini' ? createGeminiModel(key.apiKey, key.modelId) : getLocalModel(key.modelId);

  const agent = new Agent({
    name: 'huddle-assistant',
    model,
    tools: buildChatTools(widgetApi, userId, onSelectRoom),
    systemPrompt:
      'You are a helpful assistant embedded in a Matrix chat widget. You can read recent room ' +
      'messages, navigate the user to a room, and send a message on their behalf (send_message ' +
      'always pauses for the user to approve the exact text before anything is actually sent). ' +
      'There is no manual room picker in this UI any more — every room-specific tool needs a room ' +
      'ID, not a name, so when the user names or switches to a room and no "[Selected room: ...]" ' +
      'context line already gives you its ID, call get_room_id_by_name first (or list_rooms if you ' +
      'need to see what rooms are available at all), then call set_selected_room with the resolved ' +
      'ID so it stays the active room for later turns too. If the name comes back ambiguous or with ' +
      'no match, ask the user to clarify instead of guessing. ' +
      'Keep replies concise.',
    // Only meaningful once telemetry.setupTracer() has been called (see
    // langfuseTelemetry.ts, wired up in main.tsx) — a no-op attribute
    // bag otherwise. `langfuse.user.id` is Langfuse's own documented OTel
    // attribute for binding a trace to a user in its UI; not independently
    // re-verified against a live Langfuse dashboard in this repo, so
    // double-check it still renders as "user" there if this ever looks
    // like it's not showing up.
    traceAttributes: { 'langfuse.user.id': userId },
  });

  attachTraceLogging(agent, 'chat');
  cached = { key, agent };
  return agent;
}

/** Call when the user changes rooms/settings in a way that should start a fresh conversation, or explicitly resets the chat. */
export function resetChatAgent(): void {
  cached = undefined;
}
