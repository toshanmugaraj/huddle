import {
  type Agent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  MessageAddedEvent,
  InterruptEvent,
  AgentResultEvent,
} from '@strands-agents/sdk';

/**
 * Console-logs the sequence of model calls, tool calls, messages, and
 * interrupts for one Agent, via Strands' hook system
 * (agent.addHook(EventClass, callback) — confirmed against the shipped
 * .d.ts, not the docs site). This is the lightweight option: Strands also
 * has agent.stream() for live event consumption and a full
 * OpenTelemetry-based tracer/meter (AgentTrace/AgentMetrics), but those are
 * either a bigger UI change or aimed at a server-side OTLP collector —
 * overkill for "let me see what's happening while testing in devtools."
 *
 * Call once per Agent instance, right after construction. Returns a
 * cleanup function that removes all the hooks (each addHook call returns
 * its own cleanup; this just batches them).
 */
export function attachTraceLogging(agent: Agent, label: string): () => void {
  const tag = `[chat-summary:${label}]`;
  const cleanups = [
    agent.addHook(BeforeModelCallEvent, (e) => {
      console.log(`${tag} model call → ${e.model.modelId ?? '(unknown model)'}`, {
        projectedInputTokens: e.projectedInputTokens,
      });
    }),
    agent.addHook(AfterModelCallEvent, (e) => {
      if (e.error) {
        console.error(`${tag} model call failed (attempt ${e.attemptCount})`, e.error);
      } else {
        console.log(`${tag} model call done (attempt ${e.attemptCount}) → stopReason=${e.stopData?.stopReason}`);
      }
    }),
    agent.addHook(BeforeToolCallEvent, (e) => {
      console.log(`${tag} tool call → ${e.toolUse.name}`, e.toolUse.input);
    }),
    agent.addHook(AfterToolCallEvent, (e) => {
      if (e.error) {
        console.error(`${tag} tool call failed → ${e.toolUse.name}`, e.error);
      } else {
        console.log(`${tag} tool call done → ${e.toolUse.name}`, e.result);
      }
    }),
    agent.addHook(MessageAddedEvent, (e) => {
      console.log(`${tag} message added → role=${e.message.role}`, e.message.content);
    }),
    agent.addHook(InterruptEvent, (e) => {
      console.log(`${tag} interrupt raised → ${e.interrupt.name}`, e.interrupt.reason);
    }),
    agent.addHook(AgentResultEvent, (e) => {
      console.log(`${tag} turn finished → stopReason=${e.result.stopReason}`);
    }),
  ];

  return () => cleanups.forEach((cleanup) => cleanup());
}
