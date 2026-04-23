import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import App from '../src/App';
import { useAppStore } from '../src/store/useAppStore';

const processRow = {
  id: 'process-created',
  displayCode: 'PRC-TEST',
  rowVersion: 1,
  name: 'Created from test',
  description: '',
  createdAt: '2026-04-23T10:00:00.000Z',
  updatedAt: '2026-04-23T10:00:00.000Z',
  nextAuditDue: null,
  archivedAt: null,
  auditPolicy: {},
  policyVersion: 1,
};

describe('create process flow', () => {
  test('creates a process and opens the tile dashboard without a render loop', async () => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    window.sessionStorage.clear();
    useAppStore.setState({
      processes: [],
      activeProcessId: null,
      activeWorkspaceTab: 'preview',
      currentAuditResult: null,
      isAuditRunning: false,
      auditProgressText: '',
      auditRunKey: null,
      uploads: {},
      fileDrafts: {},
    });

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 'u1',
              displayCode: 'USR-1',
              email: 'admin@ses.local',
              displayName: 'SES Admin',
              role: 'admin',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/v1/processes') && init?.method === 'POST') {
        return new Response(JSON.stringify(processRow), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/processes')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/tiles')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/escalations')) {
        return new Response(JSON.stringify({ summary: { perEngineManagerCounts: {} }, managers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /create new process/i }));
    await user.type(screen.getByLabelText(/process name/i), processRow.name);
    await user.click(screen.getByRole('button', { name: /^create process$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: processRow.name })).toBeInTheDocument();
    });
  });
});
