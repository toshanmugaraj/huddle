import { tool, InterruptResponseContent, type Interrupt } from '@strands-agents/sdk';
import { z } from 'zod';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getRecentMessages } from '../matrix/messages';
import { getRoomName } from '../matrix/rooms';
import { loadSettings } from '../matrix/settingsSync';
import type { SelectedRoom } from '../state/chatStore';

/**
 * Same `[huddle:...]` tag convention as trace.ts, one level more specific
 * (per-tool, not per-agent) and with readable args/results rather than
 * trace.ts's raw toolUse.input/result JSON dump. This logs regardless of
 * whether a hook is attached to the calling Agent, so it's the one to
 * check if trace.ts's BeforeToolCallEvent/AfterToolCallEvent logging isn't
 * showing anything — most likely because the agent in question has no
 * tools at all (summarize.ts's summarizer doesn't; only chatAgent.ts does).
 */
function logTool(name: string, ...args: unknown[]) {
  console.log(`[huddle:tool:${name}]`, ...args);
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
 * All of these read `widgetApi` (and `userId`, for the two below that read
 * settings) from the closure rather than taking them as tool input — the
 * model should never be choosing *which* widget API instance or user to
 * act as, only *what* to call. `onSelectRoom` is likewise a closure-only
 * callback into the (React-external) chat store rather than a tool the
 * model could invoke on some other target.
 */
export function buildChatTools(widgetApi: WidgetApi, userId: string, onSelectRoom: (room: SelectedRoom) => void) {
  const listRooms = tool({
    name: 'list_rooms',
    description:
      "Lists the rooms this widget is configured to summarize (the ones picked in Settings), each " +
      'with its room ID and display name. There is no way to browse rooms beyond this configured ' +
      'list — Matrix widgets are not given a full list of the rooms the user has joined.',
    inputSchema: z.object({}),
    callback: async () => {
      logTool('list_rooms', 'called');
      const settings = await loadSettings(widgetApi, userId);
      const rooms = await Promise.all(
        settings.roomIds.map(async (roomId) => ({ roomId, roomName: await getRoomName(widgetApi, roomId) })),
      );
      logTool('list_rooms', `→ ${rooms.length} room(s)`);
      return { rooms };
    },
  });

  const getRoomIdByName = tool({
    name: 'get_room_id_by_name',
    description:
      'Resolves a room the user referred to by name (e.g. "the design room") to its room ID, so it ' +
      'can be passed to get_room_messages / navigate_to_room / send_message. Only searches the rooms ' +
      "configured in Settings (same set list_rooms returns) — call this instead of list_rooms when " +
      "you just need one room's ID and already have a name to search for. Returns candidates instead " +
      'of guessing when the name matches none or more than one configured room.',
    inputSchema: z.object({
      name: z.string().describe('The room display name, or a fragment of it, as the user said it.'),
    }),
    callback: async ({ name }) => {
      logTool('get_room_id_by_name', 'called with', { name });
      const settings = await loadSettings(widgetApi, userId);
      const rooms = await Promise.all(
        settings.roomIds.map(async (roomId) => ({ roomId, roomName: await getRoomName(widgetApi, roomId) })),
      );

      // Exact (case-insensitive) match wins outright even if it's also a
      // substring of some other room's name; otherwise fall back to
      // substring matching so a partial/fuzzy name like "design" still
      // finds "Design Team" without requiring the user to type it in full.
      const query = name.trim().toLowerCase();
      const exact = rooms.filter((r) => r.roomName.toLowerCase() === query);
      const matches = exact.length > 0 ? exact : rooms.filter((r) => r.roomName.toLowerCase().includes(query));

      if (matches.length === 1) {
        logTool('get_room_id_by_name', `→ matched "${matches[0].roomName}"`);
        return { matched: true as const, roomId: matches[0].roomId, roomName: matches[0].roomName };
      }

      logTool('get_room_id_by_name', `→ ${matches.length} match(es) — ambiguous or none`);
      return {
        matched: false as const,
        reason:
          matches.length === 0
            ? `No configured room's name matches "${name}".`
            : `"${name}" matches more than one configured room — ask the user which one they mean.`,
        candidates: matches.length > 0 ? matches : rooms,
      };
    },
  });

  const setSelectedRoom = tool({
    name: 'set_selected_room',
    description:
      'Sets which room the conversation is currently about, shown in the UI and automatically ' +
      "given as context on every later turn — so call this whenever the user names or switches to a " +
      'room in their message, and it stays the active room until this is called again with a ' +
      "different one. Needs a room ID: resolve it first with get_room_id_by_name if you only have " +
      'the name the user said.',
    inputSchema: z.object({
      roomId: z.string().describe('The room ID to make active, e.g. "!abc123:example.com".'),
    }),
    callback: async ({ roomId }) => {
      logTool('set_selected_room', 'called with', { roomId });
      const roomName = await getRoomName(widgetApi, roomId);
      onSelectRoom({ roomId, roomName });
      logTool('set_selected_room', `→ selected "${roomName}"`);
      return { selected: true, roomId, roomName };
    },
  });

  const getRoomMessages = tool({
    name: 'get_room_messages',
    description:
      'Reads the most recent messages in a Matrix room, regardless of date — use this for follow-up ' +
      "questions that need more history than what was already summarized (Sync only covers today).",
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

  return [listRooms, getRoomIdByName, setSelectedRoom, getRoomMessages, navigateToRoom, sendMessage];
}

/** Re-exported so routes/Chat.tsx doesn't need a separate import from the SDK for the resume call. */
export { InterruptResponseContent };
export type { Interrupt };
