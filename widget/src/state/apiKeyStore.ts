import { create } from 'zustand';

const STORAGE_KEY = 'chat-summary.gemini-api-key';

/**
 * The Gemini API key deliberately never touches the settings state event
 * (src/matrix/settingsSync.ts) — that event is plain-text room state,
 * readable by anyone with state-read access to the room (Matrix state
 * events are NOT end-to-end encrypted even in "encrypted" rooms), so it's
 * the wrong place for a credential. localStorage instead: private to this
 * browser/device, never sent to the homeserver or seen by other room
 * members — the tradeoff is it has to be re-entered per device/browser,
 * and per embedding context on browsers that partition storage for
 * cross-site iframes (Safari's full third-party blocking in particular
 * may refuse it outright). Every access below is defensive for exactly
 * that reason.
 */

function readStoredKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface ApiKeyState {
  apiKey: string;
  storageError: boolean;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
}

export const useApiKeyStore = create<ApiKeyState>((set) => ({
  apiKey: readStoredKey(),
  storageError: false,
  setApiKey: (key) => {
    try {
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      set({ apiKey: key, storageError: false });
    } catch {
      // Still reflect it in memory for this session so the rest of the UI
      // works — just flag that it won't survive a reload.
      set({ apiKey: key, storageError: true });
    }
  },
  clearApiKey: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore — see setApiKey
    }
    set({ apiKey: '' });
  },
}));
