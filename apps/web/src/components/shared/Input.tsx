import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Decorative icon/element rendered inside the field, left of the value. */
  leading?: ReactNode;
  /** Interactive/decorative element rendered inside the field, on the right. */
  trailing?: ReactNode;
  /** Applies the error border/ring treatment. */
  invalid?: boolean;
};

// Canonical text input. Encapsulates the field styling so pages stop
// hand-rolling identical className strings. Renders a real <input id=...>
// so <label htmlFor> association (and getByLabelText in tests) keeps working.
// Conventions mirror Button.tsx: forwardRef + displayName + className merge.
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', leading, trailing, invalid = false, ...props }, ref) => {
    const border = invalid
      ? 'border-danger-500 focus-within:border-danger-500 focus-within:ring-danger-500/40'
      : 'border-rule focus-within:border-brand focus-within:ring-brand/30 dark:border-gray-700';

    return (
      <div
        className={`flex items-center gap-2 rounded-md border bg-white px-3 transition-shadow duration-150 focus-within:ring-2 dark:bg-gray-800 ${border} ${className}`}
      >
        {leading ? (
          <span className="flex shrink-0 text-ink-3 dark:text-gray-400" aria-hidden="true">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
          aria-invalid={invalid || undefined}
          {...props}
        />
        {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
      </div>
    );
  },
);

Input.displayName = 'Input';
