import { create } from 'zustand';
import { DEFAULT_SETTINGS, type ChatSummarySettings } from '../matrix/settingsSync';

interface SettingsState {
  settings: ChatSummarySettings;
  loaded: boolean;
  setSettings: (settings: ChatSummarySettings) => void;
  setLoaded: (loaded: boolean) => void;
}

/** Mirrors the persisted (state-event-backed) settings for synchronous read access from any component. */
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  setSettings: (settings) => set({ settings }),
  setLoaded: (loaded) => set({ loaded }),
}));
