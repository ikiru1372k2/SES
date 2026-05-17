import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../shared/Button';
import { type DirectoryEntry, DirectoryFieldError, createManager } from '../../lib/api/directoryApi';

type FormValues = {
  code: string;
  name: string;
  email: string;
  teamsUsername: string;
  active: boolean;
};

type FormErrors = Partial<Record<'code' | 'name' | 'email', string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[A-Z0-9_-]{2,16}$/;

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1] ?? '',
  };
}

export function AddManagerForm({
  items,
  onCreated,
}: {
  items: DirectoryEntry[];
  onCreated: (entry: DirectoryEntry) => void;
}) {
  const [values, setValues] = useState<FormValues>({ code: '', name: '', email: '', teamsUsername: '', active: true });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const existingCodes = useMemo(
    () => new Set(items.map((item) => item.displayCode.trim().toUpperCase())),
    [items],
  );
  const existingEmails = useMemo(
    () => new Set(items.map((item) => item.email.trim().toLowerCase())),
    [items],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  function resetForm() {
    setValues({ code: '', name: '', email: '', teamsUsername: '', active: true });
    setErrors({});
  }

  function normalize(field: 'code' | 'name' | 'email', value: string): string {
    const trimmed = value.trim();
    if (field === 'code') return trimmed.toUpperCase();
    if (field === 'email') return trimmed.toLowerCase();
    return trimmed;
  }

  function validate(nextValues: FormValues): FormErrors {
    const nextErrors: FormErrors = {};
    const normalizedCode = normalize('code', nextValues.code);
    const normalizedName = normalize('name', nextValues.name);
    const normalizedEmail = normalize('email', nextValues.email);

    if (!normalizedCode) nextErrors.code = 'Code is required.';
    else if (!CODE_PATTERN.test(normalizedCode)) nextErrors.code = 'Code must be 2-16 chars: A-Z, 0-9, _ or -.';
    else if (existingCodes.has(normalizedCode)) nextErrors.code = 'Code already in use.';

    if (!normalizedName) nextErrors.name = 'Name is required.';
    else if (normalizedName.length < 2 || normalizedName.length > 80) nextErrors.name = 'Name must be 2-80 characters.';

    if (!normalizedEmail) nextErrors.email = 'Email is required.';
    else if (normalizedEmail.length > 254) nextErrors.email = 'Email must be 254 characters or fewer.';
    else if (!EMAIL_PATTERN.test(normalizedEmail)) nextErrors.email = 'Email is not valid.';
    else if (existingEmails.has(normalizedEmail)) nextErrors.email = 'Email already in use.';

    return nextErrors;
  }

  function focusFirstInvalid(nextErrors: FormErrors) {
    if (nextErrors.code) codeRef.current?.focus();
    else if (nextErrors.name) nameRef.current?.focus();
    else if (nextErrors.email) emailRef.current?.focus();
  }

  function onBlur(field: 'code' | 'name' | 'email') {
    const normalized = normalize(field, values[field]);
    const nextValues = { ...values, [field]: normalized };
    setValues(nextValues);
    const nextErrors = validate(nextValues);
    setErrors((prev) => ({ ...prev, [field]: nextErrors[field] }));
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalizedValues: FormValues = {
      ...values,
      code: normalize('code', values.code),
      name: normalize('name', values.name),
      email: normalize('email', values.email),
    };
    setValues(normalizedValues);
    const nextErrors = validate(normalizedValues);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstInvalid(nextErrors);
      return;
    }
    const { firstName } = splitName(normalizedValues.name);
    if (!firstName) return;
    setSubmitting(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const teamsUsername = normalizedValues.teamsUsername.trim();
      const created = await createManager(
        {
          code: normalizedValues.code,
          name: normalizedValues.name,
          email: normalizedValues.email,
          ...(teamsUsername ? { teamsUsername } : {}),
          active: normalizedValues.active,
        },
        abortRef.current.signal,
      );
      onCreated(created);
      toast.success('Manager added');
      resetForm();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof DirectoryFieldError && (err.status === 400 || err.status === 409)) {
        const field = err.field === 'code' || err.field === 'email' || err.field === 'name' ? err.field : undefined;
        if (field) {
          setErrors((prev) => ({ ...prev, [field]: err.message }));
          if (field === 'code') codeRef.current?.focus();
          if (field === 'name') nameRef.current?.focus();
          if (field === 'email') emailRef.current?.focus();
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("Couldn't save manager. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
      <div>
        <h2 className="text-base font-semibold">Add manager manually</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Use this to add a single contact. For bulk adds, use Import.
        </p>
      </div>
      <form className="space-y-3" onSubmit={onSave}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Code</span>
            <input
              ref={codeRef}
              value={values.code}
              onChange={(event) => setValues((prev) => ({ ...prev, code: event.target.value }))}
              onBlur={() => onBlur('code')}
              maxLength={16}
              aria-describedby={errors.code ? 'add-manager-code-error' : undefined}
              className={`w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-900 ${
                errors.code ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.code ? (
              <span id="add-manager-code-error" className="mt-1 block text-xs text-red-600">
                {errors.code}
              </span>
            ) : null}
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Name</span>
            <input
              ref={nameRef}
              value={values.name}
              onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
              onBlur={() => onBlur('name')}
              maxLength={80}
              aria-describedby={errors.name ? 'add-manager-name-error' : undefined}
              className={`w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-900 ${
                errors.name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.name ? (
              <span id="add-manager-name-error" className="mt-1 block text-xs text-red-600">
                {errors.name}
              </span>
            ) : null}
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Email</span>
            <input
              ref={emailRef}
              type="email"
              value={values.email}
              onChange={(event) => setValues((prev) => ({ ...prev, email: event.target.value }))}
              onBlur={() => onBlur('email')}
              maxLength={254}
              aria-describedby={errors.email ? 'add-manager-email-error' : undefined}
              className={`w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-900 ${
                errors.email ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.email ? (
              <span id="add-manager-email-error" className="mt-1 block text-xs text-red-600">
                {errors.email}
              </span>
            ) : null}
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              Teams username
            </span>
            <input
              value={values.teamsUsername}
              onChange={(event) => setValues((prev) => ({ ...prev, teamsUsername: event.target.value }))}
              onBlur={() =>
                setValues((prev) => ({ ...prev, teamsUsername: prev.teamsUsername.trim() }))
              }
              maxLength={254}
              placeholder="Teams sign-in / UPN (optional)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              Used for the Teams deep link. Falls back to email if blank.
            </span>
          </label>

          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => setValues((prev) => ({ ...prev, active: event.target.checked }))}
            />
            <span>Active</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                values.active
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {values.active ? 'Active' : 'Inactive'}
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  );
}
