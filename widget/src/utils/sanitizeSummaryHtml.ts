import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Sanitizes LLM-produced summary text before it's rendered via
 * dangerouslySetInnerHTML in SummaryCard.
 *
 * The instruction (see DEFAULT_SETTINGS.instruction in settingsSync.ts)
 * asks the model for plain HTML, but in practice every model tried —
 * Gemini included, and especially the small on-device Gemma — reliably
 * ignores that and writes Markdown instead (`**bold**`, `*(italic)*`,
 * `- list items`), presumably because that's what near-universal training
 * data biases it toward regardless of what the prompt asks for. Fed
 * straight through the old HTML-only sanitizer, none of that is a tag
 * DOMPurify recognizes, so it fell through as literal asterisks in the
 * rendered card instead of being bolded/italicized — the actual bug this
 * fixed. Running it through `marked` first turns real Markdown into HTML;
 * plain HTML the model *did* happen to emit passes through `marked`
 * unchanged (verified: `<p>x</p>` in is `<p>x</p>` out), so this is a
 * strict improvement, not a behavior swap.
 *
 * `marked`'s output is not itself sanitized (it happily round-trips
 * `<script>`/`onerror=` right back out) — DOMPurify below is still doing
 * the actual security work. This is NOT optional hardening — the model
 * has been fed real Matrix message content from other room members as
 * part of the prompt. A crafted message is a plausible (if imperfect)
 * indirect prompt-injection vector aimed at getting the model to echo
 * back a `<script>` tag or an `onerror=`-style handler in its "summary".
 * Rendering that unsanitized would execute it in this widget's own
 * origin, which already holds meaningful Matrix Widget API capabilities
 * (state event send, etc.) — a much higher-value target than a typical
 * XSS.
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
