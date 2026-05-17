import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Login } from '../Login';

const loginOnApi = vi.fn();
const navigate = vi.fn();

vi.mock('../../lib/api/authApi', () => ({
  loginOnApi: (...args: unknown[]) => loginOnApi(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/storage/sessionWorkspace', () => ({
  applySessionUserForLocalWorkspace: vi.fn(),
}));

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <div>Signup</div> },
      { path: '/', element: <div>Home</div> },
    ],
    { initialEntries: ['/login'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('Login', () => {
  beforeEach(() => {
    loginOnApi.mockReset();
    navigate.mockReset();
  });

  it('renders an inline alert (role="alert") when the API rejects', async () => {
    loginOnApi.mockRejectedValue(new Error('Invalid credentials'));
    renderLogin();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid credentials/i);
    });
  });

  it('toggles password visibility without losing the typed value', () => {
    renderLogin();
    const password = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'secret12' } });
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(password.type).toBe('text');
    expect(password.value).toBe('secret12');
  });

  it('sets aria-busy on the submit button while signing in', async () => {
    let resolve: (v: unknown) => void = () => {};
    loginOnApi.mockReturnValue(new Promise((r) => (resolve = r)));
    renderLogin();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('aria-busy', 'true');
    });
    resolve({ user: { displayName: 'A', email: 'a@b.com' } });
  });
});
