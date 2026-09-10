// ── Companion-window relay ───────────────────────────────────────────────────
// Lets Huddle open in a real, separate top-level browser window (via
// window.open() — see popout.ts) while still driving a Sync. Modeled on
// CrewBoard's frontend/src/relay.js, which found (and documents, in
// components/DocumentPip.jsx) that the Document Picture-in-Picture API is
// permanently blocked from widget iframes — Chromium hard-rejects
// requestWindow() with NotAllowedError for any iframe, unconditionally,
// regardless of Permissions-Policy. window.open() has no such restriction,
// but the new tab has no widgetId/parentUrl, so it can't do its own Widget
// API handshake (WidgetApiImpl.create() would just time out waiting for an
// Element host that isn't there). Instead: the ORIGINAL widget iframe (which
// does have a real Widget API connection) stays mounted and acts as a
// relay/transport; the popup talks to it over BroadcastChannel, which works
// between same-origin windows/tabs regardless of iframe/top-level status —
// unlike Document PiP, nothing here is gated on being a top-level browsing
// context.
//
// Unlike CrewBoard's relay (which exposes low-level Matrix primitives like
// sendMessage/readInbox one-for-one), this one exposes exactly two
// business-level actions — syncRoom and syncAll, both driven by
// agent/sync.ts — plus a getSnapshot pull and a generic push channel that
// hostBootstrap.ts wires directly to Huddle's zustand stores. The companion
// never reads room data itself; it triggers a sync on the host and watches
// the host's own store state for the result. This keeps the companion from
// ever needing its own WebGPU/local-model runtime (which would mean loading
// a multi-GB model a second time, in a separate tab, entirely pointlessly —
// the host already has one warmed up) or its own copy of any Matrix-reading
// logic to keep in sync with agent/sync.ts.
//
// Constraint this implies: the popup only works while the original widget
// iframe is still alive somewhere in Element — see popout.ts's openCompanionWindow(),
// which pins the widget first for exactly this reason.

const CHANNEL_NAME = 'huddle-companion-relay';
const HELLO_TIMEOUT_MS = 4000;
// syncAll can legitimately take a while (multi-GB model prep on first use,
// then one inference call per room, sequentially) — comfortably longer than
// a realistic worst case, same reasoning as CrewBoard's own RPC_TIMEOUT_MS
// (it timed its 20s against a fixed ~10s host-side ceiling elsewhere; ours
// has no such ceiling to time against, so it's set generously instead).
const SYNC_RPC_TIMEOUT_MS = 5 * 60 * 1000;
const RPC_TIMEOUT_MS = 20000;

const params = new URLSearchParams(window.location.search);
export const isCompanion = params.get('companion') === '1';

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel {
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function rpcId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface RequestMessage {
  kind: 'request';
  id: string;
  method: string;
  args?: unknown;
}
interface ResponseMessage {
  kind: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
interface PushMessage {
  kind: 'push';
  channel: string;
  data: unknown;
}
type RelayMessage = RequestMessage | ResponseMessage | PushMessage;

/** What the host (the real widget) actually does for each RPC method — wired up in hostBootstrap.ts, which has the real widgetApi/store access this module deliberately doesn't. */
export interface HostHandlers {
  syncRoom(roomId: string): Promise<void>;
  syncAll(): Promise<void>;
  getSnapshot(): unknown;
}

// ── Host side (runs inside the real widget iframe) ──────────────────────────
let hostStarted = false;
export function startRelayHost(handlers: HostHandlers): void {
  if (hostStarted || isCompanion) return;
  hostStarted = true;
  const ch = getChannel();

  ch.addEventListener('message', async (ev: MessageEvent<RelayMessage>) => {
    const msg = ev.data;
    if (!msg || msg.kind !== 'request') return;

    if (msg.method === 'hello') {
      ch.postMessage({ kind: 'response', id: msg.id, ok: true } satisfies ResponseMessage);
      return;
    }

    try {
      let result: unknown;
      switch (msg.method) {
        case 'getSnapshot':
          result = handlers.getSnapshot();
          break;
        case 'syncRoom':
          await handlers.syncRoom((msg.args as { roomId: string }).roomId);
          break;
        case 'syncAll':
          await handlers.syncAll();
          break;
        default:
          throw new Error(`Unknown relay method: ${msg.method}`);
      }
      ch.postMessage({ kind: 'response', id: msg.id, ok: true, result } satisfies ResponseMessage);
    } catch (e) {
      ch.postMessage({
        kind: 'response',
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      } satisfies ResponseMessage);
    }
  });
}

/** Forwards a piece of live state (a zustand store's current value, typically) from the host out to any listening companions — see hostBootstrap.ts's store subscriptions. No-op until startRelayHost() has run, and never fires from a companion window itself. */
export function broadcastPush(pushChannel: string, data: unknown): void {
  if (isCompanion || !hostStarted) return;
  getChannel().postMessage({ kind: 'push', channel: pushChannel, data } satisfies PushMessage);
}

// ── Companion side (runs in the popup) ───────────────────────────────────────
function call(method: string, args?: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ch = getChannel();
    const id = rpcId();
    const timeout = setTimeout(() => {
      ch.removeEventListener('message', onMsg);
      reject(
        new Error(
          "Couldn't reach the Huddle widget in Element — keep Huddle open " +
            '(pinned/floating is fine) for this window to work.',
        ),
      );
    }, timeoutMs);

    function onMsg(ev: MessageEvent<RelayMessage>): void {
      const msg = ev.data;
      if (!msg || msg.kind !== 'response' || msg.id !== id) return;
      clearTimeout(timeout);
      ch.removeEventListener('message', onMsg);
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    }
    ch.addEventListener('message', onMsg);
    ch.postMessage({ kind: 'request', id, method, args } satisfies RequestMessage);
  });
}

/** Confirms the host widget tab is alive and reachable. Rejects if nothing answers within HELLO_TIMEOUT_MS — the original widget iframe may have been closed/unpinned, or Element itself closed. Call before anything else in the companion. */
export function connectCompanion(): Promise<void> {
  return call('hello', undefined, HELLO_TIMEOUT_MS).then(() => undefined);
}

export const companionGetSnapshot = <T,>() => call('getSnapshot') as Promise<T>;
export const companionSyncRoom = (roomId: string) => call('syncRoom', { roomId }, SYNC_RPC_TIMEOUT_MS).then(() => undefined);
export const companionSyncAll = () => call('syncAll', undefined, SYNC_RPC_TIMEOUT_MS).then(() => undefined);

/** Live pushes forwarded from the host on `pushChannel` (see broadcastPush). Returns an unsubscribe function. */
export function subscribeCompanionPush<T>(pushChannel: string, onData: (data: T) => void): () => void {
  const ch = getChannel();
  function onMsg(ev: MessageEvent<RelayMessage>): void {
    const msg = ev.data;
    if (!msg || msg.kind !== 'push' || msg.channel !== pushChannel) return;
    onData(msg.data as T);
  }
  ch.addEventListener('message', onMsg);
  return () => ch.removeEventListener('message', onMsg);
}
