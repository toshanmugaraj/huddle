import { tool, InterruptResponseContent, type Interrupt } from '@strands-agents/sdk';
import { z } from 'zod';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getRecentMessages } from '../matrix/unread';
import { getRoomName } from '../matrix/rooms';

/**
 * Same `[chat-summary:...]` tag convention as trace.ts, one level more
 * specific (per-tool, not per-agent) and with readable args/results rather
 * than trace.ts's raw toolUse.input/result JSON dump. This logs regardless
 * of whether a hook is attached to the calling Agent, so it's the one to
 * check if trace.ts's BeforeToolCallEvent/AfterToolCallEvent logging isn't
 * showing anything — most likely because the agent in question has no
 * tools at all (summarize.ts's summarizer doesn't; only chatAgent.ts does).
 */
function logTool(name: string, ...args: unknown[]) {
  console.log(`[chat-summary:tool:${name}]`, ...args);
}

/**
 * Tools exposed to the chat agent — both Gemini and the on-device Gemma path
 * support these now (GemmaEdgeModel translates LiteRT-LM's own tool-calling
 * protocol into Strands' tool-use events; see that file's class doc). Schemas
 * here are kept to the plain object/string/number shapes LiteRT-LM's minimal
 * JSON-Schema subset understands (see `Schema` in `@litert-lm/core`) — zod
 * refinements like `.min()`/`.max()`/`.default()` still work for Gemini
 * (which gets the full JSON Schema) but silently don't carry over to the
 * local model's tool declarations, only whatever's in `.describe()` text.
 *
 * All three read `widgetApi` from the closure rather than taking it as a
 * tool input — the model should never be choosing *which* widget API
 * instance to use, only *what* to call on it.
 */
export function buildChatTools(widgetApi: WidgetApi) {
  const getRoomMessages = tool({
    name: 'get_room_messages',
    description:
      'Reads the most recent messages in a Matrix room (not just unread ones) — use this for follow-up questions that need more context than what was already summarized.',
    inputSchema: z.object({
      roomId: z.string().describe('The room ID, e.g. "!abc123:example.com".'),
      limit: z.number().int().min(1).max(100).default(20).describe('How many recent messages to fetch.'),
    }),
    callback: async ({ roomId, limit }) => {
      logTool('get_room_messages', 'called with', { roomId, limit });
      const [roomName, messages] = await Promise.all([
        getRoomName(widgetApi, roomId),
        getRecentMessages(widgetApi, roomId, limit),
      ]);
      logTool('get_room_messages', `→ ${messages.length} message(s) from "${roomName}"`);
      return {
        roomId,
        roomName,
        messages: messages.map((m) => ({ sender: m.sender, body: m.body, ts: m.originServerTs })),
      };
    },
  });

  const navigateToRoom = tool({
    name: 'navigate_to_room',
    description: "Jumps the user's Element client to the given room.",
    inputSchema: z.object({
      roomId: z.string().describe('The room ID, e.g. "!abc123:example.com".'),
    }),
    callback: async ({ roomId }) => {
      logTool('navigate_to_room', 'called with', { roomId });
      await widgetApi.navigateTo(`https://matrix.to/#/${encodeURIComponent(roomId)}`);
      logTool('navigate_to_room', '→ navigated');
      return { navigated: true, roomId };
    },
  });

  const sendMessage = tool({
    name: 'send_message',
    description:
      "Sends a message to a Matrix room on the user's behalf. This is consequential and requires the user's explicit approval — always draft the exact text first and expect a pause while it's reviewed; the tool does not send silently.",
    inputSchema: z.object({
      roomId: z.string().describe('The room ID to send to, e.g. "!abc123:example.com".'),
      text: z.string().describe('The exact message text to send.'),
    }),
    callback: async ({ roomId, text }, context) => {
      logTool('send_message', 'called with', { roomId, text });

      if (!context) {
        // Should be unreachable — Strands always passes a ToolContext for a
        // real agent invocation. Fail closed rather than send unapproved.
        logTool('send_message', '→ ERROR: no ToolContext, refusing to send');
        throw new Error('send_message has no tool context to raise an approval interrupt on.');
      }

      // Pauses the WHOLE agent turn (throws InterruptError, AgentResult
      // comes back with stopReason: 'interrupt') the first time this runs.
      // The Chat screen shows roomId/text from the interrupt's `reason` and
      // a confirm/reject UI, then resumes the SAME Agent instance with
      // `agent.invoke([new InterruptResponseContent({ interruptId, response })])`
      // — at which point this call returns the stored response instead of
      // pausing again. See agent/chatAgent.ts and routes/Chat.tsx.
      logTool('send_message', 'awaiting user approval…');
      const approved = context.interrupt<boolean>({
        name: 'confirm_send_message',
        reason: { roomId, text },
      });
      logTool('send_message', `approval resumed → ${approved ? 'approved' : 'declined'}`);

      if (!approved) {
        return { sent: false, reason: 'User declined to send this message.' };
      }

      await widgetApi.sendRoomEvent('m.room.message', { msgtype: 'm.text', body: text }, { roomId });
      logTool('send_message', '→ sent');
      return { sent: true, roomId };
    },
  });

  return [getRoomMessages, navigateToRoom, sendMessage];
}

/** Re-exported so routes/Chat.tsx doesn't need a separate import from the SDK for the resume call. */
export { InterruptResponseContent };
export type { Interrupt };
