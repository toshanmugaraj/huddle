import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Sanitizes LLM-produced Markdown/HTML text before it's rendered via
 * dangerouslySetInnerHTML — used by Chat.tsx's assistant bubbles (the Chat
 * tab's free-text replies). The Home tab's summary cards used to be this
 * function's other caller, back when summaries were free-text Markdown
 * asked for via prose instructions; agent/summarize.ts now gets its output
 * shape from a Zod structuredOutputSchema instead (real, schema-validated
 * fields — title/points strings, rendered as plain `Typography` text, no
 * HTML/Markdown parsing involved), so SummaryCard has no need for this any
 * more. Still exactly the right tool for Chat.tsx, whose replies remain
 * free-text prose with no schema to lean on.
 *
 * The reason this exists at all: every model tried — Gemini included, and
 * especially the small on-device Gemma — reliably ignores a prose
 * instruction asking for plain HTML and writes Markdown instead
 * (`**bold**`, `*(italic)*`, `- list items`), presumably because that's
 * what near-universal training data biases it toward regardless of what
 * the prompt asks for. Fed straight through an HTML-only sanitizer, none
 * of that is a tag DOMPurify recognizes, so it fell through as literal
 * asterisks in the rendered bubble instead of being bolded/italicized —
 * the actual bug this fixed. Running it through `marked` first turns real
 * Markdown into HTML; plain HTML the model *did* happen to emit passes
 * through `marked` unchanged (verified: `<p>x</p>` in is `<p>x</p>` out),
 * so this is a strict improvement, not a behavior swap.
 *
 * `marked`'s output is not itself sanitized (it happily round-trips
 * `<script>`/`onerror=` right back out) — DOMPurify below is still doing
 * the actual security work. This is NOT optional hardening — Chat tab
 * replies can be influenced by real Matrix message content the agent read
 * via its tools. A crafted message is a plausible (if imperfect) indirect
 * prompt-injection vector aimed at getting the model to echo back a
 * `<script>` tag or an `onerror=`-style handler in its reply. Rendering
 * that unsanitized would execute it in this widget's own origin, which
 * already holds meaningful Matrix Widget API capabilities (state event
 * send, etc.) — a much higher-value target than a typical XSS.
 *
 * Deliberately tight allowlist matching exactly the tags simple
 * Markdown formatting can produce — no links, no attributes, nothing
 * structural beyond simple text formatting. Anything else collapses to
 * plain text rather than erroring.
 */
export function sanitizeSummaryHtml(markdownOrHtml: string): string {
  return DOMPurify.sanitize(marked.parse(markdownOrHtml, { async: false }), {
    ALLOWED_TAGS: ['p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'br'],
    ALLOWED_ATTR: [],
  });
}
