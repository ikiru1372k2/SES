import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import toast from 'react-hot-toast';
import { Composer } from '../Composer';
import { ConfirmProvider } from '../../shared/ConfirmProvider';
import * as composeApi from '../../../lib/api/trackingComposeApi';
import * as handoff from '../../../lib/outbound/clientHandoff';

vi.mock('react-hot-toast', () => {
  const fn = vi.fn() as unknown as { (...a: unknown[]): void; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.dismiss = vi.fn();
  return { default: fn };
});

vi.mock('../../../lib/api/trackingComposeApi', () => ({
  fetchComposeStatus: vi.fn(),
  previewCompose: vi.fn(),
  saveComposeDraft: vi.fn(),
  discardComposeDraft: vi.fn(),
  sendCompose: vi.fn(),
}));

vi.mock('../../../lib/api/escalationTemplatesApi', () => ({
  fetchEscalationTemplates: vi.fn(),
}));

vi.mock('../../../lib/outbound/clientHandoff', () => ({
  openBlankWindow: vi.fn(),
  fillLoadingWindow: vi.fn(),
  fillEmailWindow: vi.fn(),
  fillEmailPreviewWindow: vi.fn(),
}));

import { fetchEscalationTemplates } from '../../../lib/api/escalationTemplatesApi';

type FakeWin = { closed: boolean; close: ReturnType<typeof vi.fn>; location: { href: string } };

function fakeWindow(): FakeWin {
  return { closed: false, close: vi.fn(), location: { href: '' } };
}

function row(p: Partial<ProcessEscalationManagerRow> = {}): ProcessEscalationManagerRow {
  return {
    managerKey: 'kumar-arjun',
    managerName: 'Kumar, Arjun',
    resolvedEmail: 'arjun.kumar@demo.com',
    directoryEmail: null,
    directoryTeamsUsername: null,
    isUnmapped: false,
    totalIssues: 1,
    countsByEngine: { 'master-data': 1 },
    findingsByEngine: {},
    stage: 'ESCALATED_L1',
    resolved: false,
    lastContactAt: null,
    lastActivityAt: null,
    slaDueAt: null,
    trackingId: 'trk-1',
    trackingDisplayCode: 'TRK-1',
    outlookCount: 0,
    teamsCount: 0,
    ...p,
  };
}

function renderComposer(panelRow: ProcessEscalationManagerRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmProvider>
          <Composer processDisplayCode="PRC-1" row={panelRow} onDone={vi.fn()} />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(composeApi.fetchComposeStatus).mockResolvedValue({ locked: false } as never);
  vi.mocked(composeApi.previewCompose).mockResolvedValue({
    subject: 'S',
    body: 'B',
    bodyHtml: '<p>B</p>',
  } as never);
  vi.mocked(fetchEscalationTemplates).mockResolvedValue([] as never);
});

describe('Composer — Teams deep link prefills To from directory username', () => {
  it('uses the directory Teams username in the deep link', async () => {
    const win = fakeWindow();
    vi.mocked(handoff.openBlankWindow).mockReturnValue(win as unknown as Window);
    vi.mocked(composeApi.sendCompose).mockResolvedValue({
      ok: true,
      notificationLogId: 'n1',
      channel: 'teams',
      subject: 'Hello',
      body: 'World',
      to: 'mgr@corp.com',
      cc: [],
    } as never);

    renderComposer(row({ directoryTeamsUsername: 'mgr@corp.com' }));
    fireEvent.click(await screen.findByRole('button', { name: /^teams/i }));

    await waitFor(() =>
      expect(composeApi.sendCompose).toHaveBeenCalledWith(
        'trk-1',
        expect.objectContaining({ channel: 'teams' }),
      ),
    );
    await waitFor(() =>
      expect(win.location.href).toMatch(
        /^https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0\?users=mgr%40corp\.com&message=/,
      ),
    );
    expect(toast).not.toHaveBeenCalled(); // no missing-username warning
    expect(toast.success).toHaveBeenCalledWith('Recorded — Teams opening…');
  });

  it('warns and omits users (empty To) when no directory Teams username', async () => {
    const win = fakeWindow();
    vi.mocked(handoff.openBlankWindow).mockReturnValue(win as unknown as Window);
    vi.mocked(composeApi.sendCompose).mockResolvedValue({
      ok: true,
      notificationLogId: 'n1',
      channel: 'teams',
      subject: 'Hello',
      body: 'World',
      to: 'arjun.kumar@demo.com',
      cc: [],
    } as never);

    renderComposer(row({ directoryTeamsUsername: null }));
    fireEvent.click(await screen.findByRole('button', { name: /^teams/i }));

    await waitFor(() => expect(composeApi.sendCompose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('No Teams username in Manager Directory'),
      { icon: '⚠️' },
    );
    await waitFor(() => expect(win.location.href).toContain('message='));
    expect(win.location.href).not.toContain('users=');
    expect(win.location.href).not.toContain('arjun.kumar'); // email never used as To
  });

  it('treats a whitespace-only directory username as missing', async () => {
    const win = fakeWindow();
    vi.mocked(handoff.openBlankWindow).mockReturnValue(win as unknown as Window);
    vi.mocked(composeApi.sendCompose).mockResolvedValue({
      ok: true,
      notificationLogId: 'n1',
      channel: 'teams',
      subject: 'Hello',
      body: 'World',
      to: 'arjun.kumar@demo.com',
      cc: [],
    } as never);

    renderComposer(row({ directoryTeamsUsername: '   ' }));
    fireEvent.click(await screen.findByRole('button', { name: /^teams/i }));

    await waitFor(() => expect(composeApi.sendCompose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('No Teams username in Manager Directory'),
      { icon: '⚠️' },
    );
    await waitFor(() => expect(win.location.href).not.toContain('users='));
  });

  it('Outlook send is unaffected (no Teams warning, channel email)', async () => {
    const win = fakeWindow();
    vi.mocked(handoff.openBlankWindow).mockReturnValue(win as unknown as Window);
    vi.mocked(composeApi.sendCompose).mockResolvedValue({
      ok: true,
      notificationLogId: 'n1',
      channel: 'email',
      subject: 'Hello',
      body: 'World',
      bodyHtml: '<p>World</p>',
      to: 'arjun.kumar@demo.com',
      cc: [],
    } as never);

    renderComposer(row({ directoryTeamsUsername: null }));
    fireEvent.click(await screen.findByRole('button', { name: /^outlook/i }));

    await waitFor(() =>
      expect(composeApi.sendCompose).toHaveBeenCalledWith(
        'trk-1',
        expect.objectContaining({ channel: 'email' }),
      ),
    );
    expect(toast).not.toHaveBeenCalled();
    expect(handoff.fillEmailWindow).toHaveBeenCalled();
  });
});
