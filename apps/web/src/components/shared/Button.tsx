import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-soft hover:bg-brand-hover hover:shadow-soft-md active:bg-brand-hover disabled:opacity-40 disabled:shadow-none',
  secondary:
    'border border-gray-300 bg-white text-gray-900 shadow-soft hover:border-brand hover:text-brand hover:bg-gray-50 hover:shadow-soft-md disabled:opacity-40 disabled:shadow-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
  ghost:
    'text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800',
  danger:
    'bg-red-600 text-white shadow-soft hover:bg-red-700 hover:shadow-soft-md active:bg-red-700 disabled:opacity-40 disabled:shadow-none',
};

// min-h keeps the hit target ≥ 36px (sm) / 40px (md). Icon-only callers
// should pass an explicit size class; text buttons clear 44px with content.
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-xs',
  md: 'min-h-[40px] px-4 py-2 text-sm',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  leading?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** Shows a spinner, sets aria-busy, and disables the button. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = '',
      leading,
      loading = false,
      size = 'md',
      type = 'button',
      variant = 'primary',
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 ease-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 dark:focus-visible:ring-offset-gray-900 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden="true" />
      ) : (
        leading
      )}
      {children}
    </button>
  ),
);

Button.displayName = 'Button';
