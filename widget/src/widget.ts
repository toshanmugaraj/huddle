import { WidgetApiImpl } from '@matrix-widget-toolkit/api';
import { buildCapabilities } from './capabilities';

// Bootstrapped at module load, not inside a component effect — see the
// nordeck-widget skill's §1 on why this matters (the handshake can be
// missed, especially on Safari, if it starts late). Both this module and
// <MuiWidgetApiProvider> await this same promise.
export const widgetApiPromise = WidgetApiImpl.create({
  capabilities: buildCapabilities(),
  // This widget's whole design depends on the WebGPU/LiteRT-LM runtime
  // living inside a real Element iframe (see spike-webgpu) — it has no
  // meaningful standalone mode.
  supportStandalone: false,
});
