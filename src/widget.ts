import { WidgetApiImpl, type WidgetApi } from '@matrix-widget-toolkit/api';
import { buildCapabilities } from './capabilities';
import { isCompanion } from './companion/relay';

// Bootstrapped at module load, not inside a component effect — see the
// nordeck-widget skill's §1 on why this matters (the handshake can be
// missed, especially on Safari, if it starts late). Both this module and
// <MuiWidgetApiProvider> await this same promise.
//
// Guarded on !isCompanion: this module is imported unconditionally from
// main.tsx (both the real-widget and companion-window branches, plus
// hostBootstrap.ts) since ES module top-level code runs once at import
// regardless of which branch pulled it in — so without this guard, a
// companion window (a plain page with no parent Element frame at all)
// would still attempt a real WidgetApiImpl.create() handshake on every
// load and never get one. Nothing in the companion path ever reads this
// export (main.tsx's companion branch doesn't render <MuiWidgetApiProvider>,
// and hostBootstrap.ts's startCompanionHost() early-returns on isCompanion
// before touching it), so an eternally-pending promise here is harmless —
// just never awaited, not a leak or a visible error.
export const widgetApiPromise = isCompanion
  ? new Promise<WidgetApi>(() => {})
  : WidgetApiImpl.create({
      capabilities: buildCapabilities(),
      // This widget's whole design depends on the WebGPU/LiteRT-LM runtime
      // living inside a real Element iframe — it has no meaningful standalone
      // mode.
      supportStandalone: false,
    });
