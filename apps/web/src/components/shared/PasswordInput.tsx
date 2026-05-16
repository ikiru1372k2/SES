import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Password field with a show/hide toggle and a caps-lock hint (audit U-05).
// Toggling visibility never moves focus or clears the value — it only swaps
// the input's `type`. The caps-lock hint is announced politely via the
// surrounding label, and the toggle button is excluded from the tab order's
// happy path only by being a real <button> after the input.
export function PasswordInput({
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  }

  return (
    <div>
      <div className="relative">
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          className={`w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-sm placeholder:text-gray-500 focus:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400 ${className}`}
          aria-describedby={capsLock ? `${id}-caps` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {capsLock ? (
        <p id={`${id}-caps`} role="status" className="mt-1 text-[11px] font-medium text-warning-700">
          Caps Lock is on.
        </p>
      ) : null}
    </div>
  );
}
