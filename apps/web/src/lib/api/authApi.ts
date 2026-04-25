import type { SessionUser } from '@ses/domain';
import { JSON_HEADERS, parseApiError } from './client';

export type SignupPayload = {
  email: string;
  displayName: string;
  password: string;
  role: 'admin' | 'auditor';
};

export type LoginPayload = {
  email: string;
  password: string;
};

export async function signupOnApi(payload: SignupPayload): Promise<{ user: SessionUser }> {
  const res = await fetch('/api/v1/auth/signup', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseApiError(res, 'Signup failed');
  return (await res.json()) as { user: SessionUser };
}

export async function loginOnApi(payload: LoginPayload): Promise<{ user: SessionUser }> {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseApiError(res, 'Login failed');
  return (await res.json()) as { user: SessionUser };
}
