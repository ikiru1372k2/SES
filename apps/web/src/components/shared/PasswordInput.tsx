import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from './Input';

// Password field with a leading lock icon, a show/hide toggle and a
// caps-lock hint (audit U-05). Toggling visibility never moves focus or
// clears the value — it only swaps the input's `type`. Built on the shared
// Input so the field styling stays consistent app-wide.
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
      <Input
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        onKeyDown={trackCapsLock}
        onKeyUp={trackCapsLock}
        className={className}
        aria-describedby={capsLock ? `${id}-caps` : undefined}
        leading={<Lock size={15} />}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            tabIndex={-1}
            className="rounded-sm p-0.5 text-ink-3 transition-colors hover:text-ink dark:text-gray-400 dark:hover:text-gray-200"
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
      />
      {capsLock ? (
        <p id={`${id}-caps`} role="status" className="mt-1 text-[11px] font-medium text-warning-700">
          Caps Lock is on.
        </p>
      ) : null}
    </div>
  );
}
