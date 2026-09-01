import { useEffect, useState } from 'react';
import { Alert, Box, IconButton, Snackbar, Tab, Tabs, Tooltip } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import { Home } from './Home';
import { Chat } from './Chat';
import { Settings } from './Settings';
import { rawWidgetApi } from '../matrix/rawApi';
import { useIsCompact } from '../hooks/useIsCompact';

type TabValue = 'home' | 'chat' | 'settings';

export function AppRoutes() {
  const widgetApi = useWidgetApi();
  const [tab, setTab] = useState<TabValue>('home');
  const [pinned, setPinned] = useState(false);
  const [pinError, setPinError] = useState<string | undefined>();
  const compact = useIsCompact();

  // No getter/observer for this on the Widget API (confirmed against
  // matrix-widget-api's WidgetApi — setAlwaysOnScreen is write-only from
  // the widget's side), so `pinned` is this widget's own best guess: it
  // can drift if the user unpins from Element's native UI instead of this
  // button, with no way for us to notice.
  //
  // One drift case IS fixable, and matters a lot more than it looks:
  // Element re-parents the widget's iframe into its separate floating PiP
  // container when pinning, which remounts this component — resetting
  // `pinned` back to its `useState(false)` default right as we land in the
  // one place it's actually true. Left alone, the button then shows "Pin"
  // instead of "Unpin" while already pinned, so a click re-requests
  // `setAlwaysOnScreen(true)` (already true, so nothing visibly happens)
  // instead of the unpin the user is actually going for — this is the "pin
  // won't unpin again in PiP" bug. `compact` is a real signal, not a guess
  // (it reads the iframe's actual size), and compact only ever happens via
  // Element's PiP, so seeing it means we ARE pinned — self-heal from it.
  useEffect(() => {
    if (compact) setPinned(true);
  }, [compact]);

  const togglePin = async () => {
    const next = !pinned;
    try {
      // Not gating on the resolved `success` boolean any more — some hosts
      // apply the change but don't reliably report it back, which made this
      // surface a "didn't confirm" warning even when pinning had actually
      // worked. A thrown error (below) is still a real signal; a falsy
      // `success` on its own isn't reliable enough to warn about.
      await rawWidgetApi(widgetApi).setAlwaysOnScreen(next);
      setPinned(next);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
    }
  };

  // Compact (PiP) mode: no tab switcher — Element's PiP is small and fixed
  // (confirmed not resizable, only movable), so there's no room to browse
  // Summaries/Settings there anyway. Chat is the one thing worth keeping
  // reachable while pinned (that's the whole point of pinning — staying
  // connected to the assistant while browsing other rooms), so it's what
  // renders regardless of whatever tab was last selected before going
  // compact. The pin toggle stays visible — it's the only way back out.
  const activeTab = compact ? 'chat' : tab;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {!compact && (
          <Tabs value={tab} onChange={(_, v: TabValue) => setTab(v)} variant="fullWidth" sx={{ flex: 1 }}>
            <Tab value="home" label="Summaries" />
            <Tab value="chat" label="Chat" />
            <Tab value="settings" label="Settings" />
          </Tabs>
        )}
        <Tooltip title={pinned ? 'Unpin (widget closes when you leave this room)' : 'Pin (keep this widget open while you browse other rooms)'}>
          <IconButton
            onClick={togglePin}
            color={pinned ? 'primary' : 'default'}
            size={compact ? 'small' : 'medium'}
            sx={{ mx: 0.5, ml: compact ? 1 : 0.5 }}
          >
            {pinned ? '📌' : '📍'}
          </IconButton>
        </Tooltip>
      </Box>
      {/* minHeight: 0 is load-bearing here, not decoration — a flex item
          defaults to min-height: auto, so without it this box would grow
          to fit its content instead of clipping+scrolling, which is
          exactly what made chat responses get pushed out of view in a
          short PiP window instead of being reachable by scrolling. */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: compact ? 0.5 : 2 }}>
        {activeTab === 'home' && <Home />}
        {activeTab === 'chat' && <Chat compact={compact} />}
        {activeTab === 'settings' && <Settings />}
      </Box>
      <Snackbar open={!!pinError} autoHideDuration={5000} onClose={() => setPinError(undefined)}>
        <Alert severity="warning" onClose={() => setPinError(undefined)}>
          {pinError}
        </Alert>
      </Snackbar>
    </Box>
  );
}
