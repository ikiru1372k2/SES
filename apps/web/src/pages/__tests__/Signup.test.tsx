import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Signup } from '../Signup';

const signupOnApi = vi.fn();
const navigate = vi.fn();

vi.mock('../../lib/api/authApi', () => ({
  signupOnApi: (...args: unknown[]) => signupOnApi(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/storage/sessionWorkspace', () => ({
  applySessionUserForLocalWorkspace: vi.fn(),
}));

function renderSignup() {
  const router = createMemoryRouter(
    [
      { path: '/signup', element: <Signup /> },
      { path: '/login', element: <div>Login</div> },
      { path: '/', element: <div>Home</div> },
    ],
    { initialEntries: ['/signup'] },
  );
  return render(<RouterProvider router={router} />);
}

function fillForm(opts: { displayName?: string; email?: string; password?: string; confirmPassword?: string }) {
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: opts.displayName ?? 'Test User' } });
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: opts.email ?? 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: opts.password ?? 'pw12345678' } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: opts.confirmPassword ?? 'pw12345678' },
  });
}

describe('Signup', () => {
  beforeEach(() => {
    signupOnApi.mockReset();
    navigate.mockReset();
  });

  it('blocks submit and shows validation message when passwords do not match', () => {
    renderSignup();
    fillForm({ password: 'pw12345678', confirmPassword: 'different-pw' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(signupOnApi).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('calls signupOnApi with the entered values when the form is valid', async () => {
    signupOnApi.mockResolvedValue({ user: { displayName: 'Test User', email: 'test@example.com' } });
    renderSignup();
    fillForm({ displayName: '  Test User  ', email: '  test@example.com  ' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signupOnApi).toHaveBeenCalledTimes(1);
    });
    expect(signupOnApi).toHaveBeenCalledWith({
      email: 'test@example.com',
      displayName: 'Test User',
      password: 'pw12345678',
      role: 'auditor',
    });
  });
});
