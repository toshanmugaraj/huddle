import type { WidgetApi, WidgetApiImpl } from '@matrix-widget-toolkit/api';

/**
 * Escape hatch to the underlying `matrix-widget-api` instance, for calls
 * the `@matrix-widget-toolkit/api` wrapper doesn't expose (e.g. room
 * account data — see unread.ts). The `WidgetApi` *interface* doesn't
 * declare `matrixWidgetApi`, but the concrete object behind it is always a
 * `WidgetApiImpl` in this app (created via `WidgetApiImpl.create()` in
 * widget.ts), which does carry it.
 */
export function rawWidgetApi(widgetApi: WidgetApi) {
  return (widgetApi as WidgetApiImpl).matrixWidgetApi;
}
