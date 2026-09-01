import DOMPurify from 'dompurify';

/**
 * Sanitizes LLM-produced summary HTML before it's rendered via
 * dangerouslySetInnerHTML in SummaryCard.
 *
 * This is NOT optional hardening — the model has been fed real Matrix
 * message content from other room members as part of the prompt. A
 * crafted message is a plausible (if imperfect) indirect prompt-injection
 * vector aimed at getting the model to echo back a `<script>` tag or an
 * `onerror=`-style handler in its "summary". Rendering that unsanitized
 * would execute it in this widget's own origin, which already holds
 * meaningful Matrix Widget API capabilities (state event send, etc.) — a
 * much higher-value target than a typical XSS.
 *
 * Deliberately tight allowlist matching exactly the tags the summary
 * instruction (see DEFAULT_SETTINGS.instruction in settingsSync.ts) asks
 * the model to use — no links, no attributes, nothing structural beyond
 * simple text formatting. Anything else collapses to plain text rather
 * than erroring.
 */
export function sanitizeSummaryHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'br'],
    ALLOWED_ATTR: [],
  });
}
