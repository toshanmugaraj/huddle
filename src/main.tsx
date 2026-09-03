import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MuiThemeProvider, MuiWidgetApiProvider } from '@matrix-widget-toolkit/mui';
import { useThemeSelection } from '@matrix-widget-toolkit/react';
import { widgetApiPromise } from './widget';
import { rawWidgetApi } from './matrix/rawApi';
import { AppRoutes } from './routes/AppRoutes';
import { initLangfuseTelemetry } from './agent/langfuseTelemetry';

// No-ops unless VITE_LANGFUSE_* env vars were set at build time (see
// .env.example and langfuseTelemetry.ts's file comment) — must run before
// any Agent is constructed (chatAgent.ts/summarize.ts), since it's what
// registers the OTel tracer provider those Agents report to.
initLangfuseTelemetry();

/**
 * Forwards Element's live `action:theme_change` to-widget message into
 * `setTheme()`, since the `$org.matrix.msc2873.client_theme` registration
 * placeholder only sets the theme once at initial load (see the
 * nordeck-widget skill's §3). The to-widget payload is documented only as
 * "arbitrary contents" (matrix-widget-api's own JSDoc) — this reads the
 * common `name`/`theme` field names defensively; verify against a live
 * Element session if theme sync doesn't take effect.
 */
function ThemeSync() {
  const { setTheme } = useThemeSelection();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    widgetApiPromise.then((widgetApi) => {
      const handler = (event: CustomEvent<{ data?: Record<string, unknown> }>) => {
        const data = event.detail?.data ?? {};
        const theme = (data.name ?? data.theme) as string | undefined;
        if (theme) setTheme(theme);
      };
      rawWidgetApi(widgetApi).on('action:theme_change', handler);
      unsubscribe = () => rawWidgetApi(widgetApi).off('action:theme_change', handler);
    });

    return () => unsubscribe?.();
  }, [setTheme]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MuiThemeProvider>
      <ThemeSync />
      <MuiWidgetApiProvider widgetApiPromise={widgetApiPromise}>
        <AppRoutes />
      </MuiWidgetApiProvider>
    </MuiThemeProvider>
  </StrictMode>,
);
