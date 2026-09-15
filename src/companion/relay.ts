// ── Companion-window relay ───────────────────────────────────────────────────
// Lets Huddle open in a real, separate top-level browser window (via
// window.open() — see popout.ts) while still driving a Sync. The new tab has
// no widgetId/parentUrl, so it can't do its own Widget API handshake
// (WidgetApiImpl.create() would just time out waiting for an Element host
// that isn't there). Instead: the ORIGINAL widget iframe (which does have a
// real Widget API connection) stays mounted and acts as a relay/transport;
// the popup talks to it directly over window.postMessage(), using the live
// window.opener reference window.open() leaves behind.
//
// Transport history/why NOT BroadcastChannel, despite CrewBoard's relay.js
// (frontend/src/relay.js in crewboard-open) using exactly that: verified
// live (2026-09-13) that a BroadcastChannel of the same name does NOT bridge
// the widget iframe and the companion popup once Element itself is hosted on
// a different site than the widget — e.g. widget on dune.wahatbh.com,
// Element on app.element.io. It DID work when Element was hosted on a
// sibling wahatbh.com subdomain instead. That's Chrome's storage
// partitioning: BroadcastChannel is partitioned by the *top-level site* a
// context is embedded under, not just by origin, so a third-party iframe
// (widget, embedded under Element's site) and an unpartitioned top-level tab
// (the companion, opened via window.open()) land in different partitions
// even though both are nominally the exact same origin. Verified from
// element-web's own source that this isn't a sandboxed-iframe/opaque-origin
// issue instead — AppTile.tsx's sandboxFlags include `allow-same-origin` and
// `allow-popups-to-escape-sandbox`, so the widget iframe carries its real
// origin and window.open() from inside it produces a normal, unsandboxed
// top-level window.
//
// window.postMessage() between the popup and window.opener sidesteps
// partitioning entirely — it's a direct reference between two Window
// objects, not mediated by any shared browser storage, so it works
// regardless of what site embeds the widget. Document Picture-in-Picture
// (an alternative "new window" mechanism CrewBoard's DocumentPip.jsx
// evaluated first) is not an option here either: Chromium unconditionally
// rejects requestWindow() from any iframe, regardless of Permissions-Policy.
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
// iframe is still alive somewhere in Element — see popout.ts's
// openCompanionWindow(), which pins the widget first for exactly this
// reason — AND while window.opener hasn't been severed (a fresh page load
// of the popup's URL typed/pasted directly, rather than opened via the 🗗
// button, has no opener at all; see call()'s upfront check for that case).

const HELLO_TIMEOUT_MS = 4000;
// syncAll can legitimately take a while (multi-GB model prep on first use,
// then one inference call per room, sequentially) — comfortably longer than
// a realistic worst case, same reasoning as CrewBoard's own RPC_TIMEOUT_MS
// (it timed its 20s against a fixed ~10s host-side ceiling elsewhere; ours
// has no such ceiling to time against, so it's set generously instead).
const SYNC_RPC_TIMEOUT_MS = 5 * 60 * 1000;
const RPC_TIMEOUT_MS = 20000;

// Tags every message this relay sends so its window 'message' listeners
// (both sides use the same global event, alongside whatever else the page
// happens to post to itself) can cheaply ignore anything that isn't ours,
// without throwing on unrelated shapes.
const MESSAGE_SOURCE = 'huddle-companion-relay';

const params = new URLSearchParams(window.location.search);
export const isCompanion = params.get('companion') === '1';

function rpcId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface RequestMessage {
  source: typeof MESSAGE_SOURCE;
  kind: 'request';
  id: string;
  method: string;
  args?: unknown;
}
interface ResponseMessage {
  source: typeof MESSAGE_SOURCE;
  kind: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
interface PushMessage {
  source: typeof MESSAGE_SOURCE;
  kind: 'push';
  channel: string;
  data: unknown;
}
type RelayMessage = RequestMessage | ResponseMessage | PushMessage;

function isRelayMessage(data: unknown): data is RelayMessage {
  return !!data && typeof data === 'object' && (data as { source?: unknown }).source === MESSAGE_SOURCE;
}

/** What the host (the real widget) actually does for each RPC method — wired up in hostBootstrap.ts, which has the real widgetApi/store access this module deliberately doesn't. */
export interface HostHandlers {
  syncRoom(roomId: string): Promise<void>;
  syncAll(): Promise<void>;
  getSnapshot(): unknown;
  /** Lets the companion use the "open in Element" escape hatch (Home.tsx's per-card button) even though it has no Widget API of its own — navigateTo only exists on the real widget's live connection, so the host does it on the companion's behalf. */
  navigateTo(roomId: string): Promise<void>;
}

// ── Host side (runs inside the real widget iframe) ──────────────────────────
let hostStarted = false;
// Set by popout.ts right after window.open() succeeds — the host's only way
// to reach the companion UNPROMPTED (a push, not a reply to some incoming
// request it already has an `event.source` for). Not persisted/rediscovered
// any other way: if the widget iframe itself reloads, this resets to null
// same as hostStarted does, and a still-open companion's next RPC call will
// simply time out until the user re-opens it via the button.
let companionWindowRef: Window | null = null;

export function registerCompanionWindow(win: Window | null): void {
  companionWindowRef = win;
}

export function startRelayHost(handlers: HostHandlers): void {
  if (hostStarted || isCompanion) return;
  hostStarted = true;

  window.addEventListener('message', (ev: MessageEvent) => {
    // Same-origin only — see this file's header comment: both sides are
    // always served from the identical origin, so a mismatch here means the
    // message isn't from our own companion at all (defense in depth, not a
    // scenario this app's own popup would ever trigger).
    if (ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!isRelayMessage(msg) || msg.kind !== 'request') return;
    const replyTo = ev.source as Window | null;
    if (!replyTo) return;

    const respond = (payload: Pick<ResponseMessage, 'ok' | 'result' | 'error'>) => {
      replyTo.postMessage(
        { source: MESSAGE_SOURCE, kind: 'response', id: msg.id, ...payload } satisfies ResponseMessage,
        ev.origin,
      );
    };

    if (msg.method === 'hello') {
      respond({ ok: true });
      return;
    }

    (async () => {
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
          case 'navigateTo':
            await handlers.navigateTo((msg.args as { roomId: string }).roomId);
            break;
          default:
            throw new Error(`Unknown relay method: ${msg.method}`);
        }
        respond({ ok: true, result });
      } catch (e) {
        respond({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}

/** Forwards a piece of live state (a zustand store's current value, typically) from the host out to the open companion window, if any — see hostBootstrap.ts's store subscriptions. No-op until startRelayHost() has run, never fires from a companion window itself, and silently drops if no companion is currently registered/open. */
export function broadcastPush(pushChannel: string, data: unknown): void {
  if (isCompanion || !hostStarted) return;
  if (!companionWindowRef || companionWindowRef.closed) {
    companionWindowRef = null;
    return;
  }
  try {
    companionWindowRef.postMessage(
      { source: MESSAGE_SOURCE, kind: 'push', channel: pushChannel, data } satisfies PushMessage,
      window.location.origin,
    );
  } catch {
    // Companion navigated away/closed between the .closed check above and
    // this call — drop the stale reference rather than keep retrying it.
    companionWindowRef = null;
  }
}

// ── Companion side (runs in the popup) ───────────────────────────────────────
function call(method: string, args?: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!window.opener) {
      reject(
        new Error(
          "This window isn't connected to Huddle — open it using the 🗗 button inside the widget " +
            "in Element, not by opening this URL directly.",
        ),
      );
      return;
    }

    const id = rpcId();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(
        new Error(
          "Couldn't reach the Huddle widget in Element — keep Huddle open " +
            '(pinned/floating is fine) for this window to work.',
        ),
      );
    }, timeoutMs);

    function onMsg(ev: MessageEvent): void {
      if (ev.origin !== window.location.origin || ev.source !== window.opener) return;
      const msg = ev.data;
      if (!isRelayMessage(msg) || msg.kind !== 'response' || msg.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMsg);
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    }
    window.addEventListener('message', onMsg);
    window.opener.postMessage(
      { source: MESSAGE_SOURCE, kind: 'request', id, method, args } satisfies RequestMessage,
      window.location.origin,
    );
  });
}

/** Confirms the host widget tab is alive and reachable. Rejects if nothing answers within HELLO_TIMEOUT_MS — the original widget iframe may have been closed/unpinned, or Element itself closed — or immediately if this window has no `window.opener` at all (opened some way other than the 🗗 button). Call before anything else in the companion. */
export function connectCompanion(): Promise<void> {
  return call('hello', undefined, HELLO_TIMEOUT_MS).then(() => undefined);
}

export const companionGetSnapshot = <T,>() => call('getSnapshot') as Promise<T>;
export const companionSyncRoom = (roomId: string) => call('syncRoom', { roomId }, SYNC_RPC_TIMEOUT_MS).then(() => undefined);
export const companionSyncAll = () => call('syncAll', undefined, SYNC_RPC_TIMEOUT_MS).then(() => undefined);
export const companionNavigateTo = (roomId: string) => call('navigateTo', { roomId }).then(() => undefined);

/** Live pushes forwarded from the host on `pushChannel` (see broadcastPush). Returns an unsubscribe function. */
export function subscribeCompanionPush<T>(pushChannel: string, onData: (data: T) => void): () => void {
  function onMsg(ev: MessageEvent): void {
    if (ev.origin !== window.location.origin || ev.source !== window.opener) return;
    const msg = ev.data;
    if (!isRelayMessage(msg) || msg.kind !== 'push' || msg.channel !== pushChannel) return;
    onData(msg.data as T);
  }
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
