import { forwardRef, type ElementType, type HTMLAttributes } from 'react';

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Adds hover border/elevation. Use for clickable cards/tiles. */
  interactive?: boolean;
  /** Underlying element. Defaults to a div. */
  as?: 'div' | 'section' | 'article';
  /** Applies the standard p-5 inset. Set false for custom padding. */
  padded?: boolean;
};

/**
 * Premium surface primitive. Composes the shared `.surface-card` design-system
 * classes so card sites stop hand-rolling the long
 * `rounded-xl border ... shadow ... dark:...` string. Purely presentational —
 * forwards every prop/ref so callers keep full control of handlers and a11y.
 *
 * For interactive elements that must remain a <button> (e.g. FunctionTile) or
 * already carry handlers on a semantic element, apply the
 * `.surface-card-interactive` class directly instead of swapping the element.
 */
export const Card = forwardRef<HTMLElement, CardProps>(
  ({ as = 'div', interactive = false, padded = true, className = '', children, ...props }, ref) => {
    const Tag = as as ElementType;
    const base = interactive ? 'surface-card-interactive' : 'surface-card';
    return (
      <Tag ref={ref} className={`${base} ${padded ? 'p-5' : ''} ${className}`} {...props}>
        {children}
      </Tag>
    );
  },
);

Card.displayName = 'Card';
