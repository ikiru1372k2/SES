import { useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A textarea that highlights {{token}} placeholders by layering a read-only
 * highlight div behind the transparent textarea. No external dependencies —
 * pure CSS with a shared font stack so the highlight div tracks character
 * positions exactly.
 *
 * Usage:
 *   <TokenTextarea value={body} onChange={e => setBody(e.target.value)} rows={7} />
 */

// Tailwind doesn't purge dynamic classes built by string concat, so we list
// the full class strings here so they're included in the production bundle.
const HIGHLIGHT_MARK = 'rounded bg-brand/10 px-0.5 font-semibold text-brand dark:bg-brand/20 dark:text-red-300';

function highlight(text: string): string {
  // Escape HTML entities first so injected text can't break the overlay.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Preserve whitespace exactly as typed
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '<br />');

  // Wrap each {{token}} in a styled mark element.
  return escaped.replace(
    /(\{\{[^}]+\}\})/g,
    `<mark class="${HIGHLIGHT_MARK}">$1</mark>`,
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'>;

export function TokenTextarea({ value, className, rows = 6, ...rest }: TextareaProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Mirror the textarea scroll position to the highlight backdrop so the
  // highlights stay aligned when the user scrolls inside the textarea.
  function syncScroll(el: HTMLTextAreaElement) {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = el.scrollTop;
      backdropRef.current.scrollLeft = el.scrollLeft;
    }
  }

  const sharedStyle =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed font-mono dark:border-gray-700 overflow-auto whitespace-pre-wrap break-words';

  return (
    <div className="relative">
      {/* Highlight backdrop — sits behind the textarea */}
      <div
        ref={backdropRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${sharedStyle} text-transparent`}
        style={{ zIndex: 0 }}
        dangerouslySetInnerHTML={{ __html: highlight(String(value ?? '')) + '&nbsp;' }}
      />
      {/* Actual textarea — transparent background so backdrop shows through */}
      <textarea
        value={value}
        rows={rows}
        spellCheck
        className={`relative ${sharedStyle} bg-transparent caret-gray-900 dark:caret-gray-100 ${className ?? ''}`}
        style={{ zIndex: 1, color: 'transparent', caretColor: 'inherit', resize: 'vertical' }}
        onScroll={(e) => syncScroll(e.currentTarget)}
        {...rest}
      />
      {/* Visible text layer — same font, same position, actual color */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${sharedStyle} text-gray-900 dark:text-gray-100`}
        style={{ zIndex: 2, color: 'inherit', overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: highlight(String(value ?? '')) + '&nbsp;' }}
      />
    </div>
  );
}
