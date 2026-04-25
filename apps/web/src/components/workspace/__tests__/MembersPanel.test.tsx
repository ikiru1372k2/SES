import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../shared/ConfirmProvider';
import { MembersPanel } from '../MembersPanel';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('../../../lib/api/membersApi', () => ({
  listMembers: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
}));

import * as membersApi from '../../../lib/api/membersApi';

function renderPanel(opts?: { canManage?: boolean }) {
  return render(
    <ConfirmProvider>
      <MembersPanel
        processIdOrCode="P-1"
        currentUserCode="U-CURRENT"
        canManage={opts?.canManage ?? true}
        onClose={() => {}}
      />
    </ConfirmProvider>,
  );
}

describe('MembersPanel — invite scope flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(membersApi.listMembers).mockResolvedValue([]);
    vi.mocked(membersApi.addMember).mockResolvedValue({ id: 'm1', displayCode: 'M-1', changed: true });
  });

  it('toggling Scoped reveals the scope editor and submits a scoped payload', async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText('email@company.com'), {
      target: { value: 'a@b.test' },
    });
    fireEvent.click(screen.getByLabelText(/Scoped/i));
    // Tick the Master Data checkbox (its label text comes from FUNCTION_REGISTRY).
    const masterDataLabel = await screen.findByText('Master Data');
    const masterDataRow = masterDataLabel.closest('label');
    expect(masterDataRow).not.toBeNull();
    const masterDataCheckbox = within(masterDataRow as HTMLElement).getByRole('checkbox');
    fireEvent.click(masterDataCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /Add/ }));

    await waitFor(() => expect(vi.mocked(membersApi.addMember)).toHaveBeenCalled());
    const [, body] = vi.mocked(membersApi.addMember).mock.calls[0]!;
    expect(body.email).toBe('a@b.test');
    expect(body.permission).toBe('editor');
    expect(body.accessMode).toBe('scoped');
    expect(body.scopes).toEqual([
      { scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' },
    ]);
  });

  it('selecting permission=owner hides the scope editor and submits without scopes', async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText('email@company.com'), {
      target: { value: 'owner@b.test' },
    });
    const permissionSelect = screen.getByDisplayValue('editor') as HTMLSelectElement;
    fireEvent.change(permissionSelect, { target: { value: 'owner' } });
    // Wait for React's controlled-select to actually swap the displayed value.
    await waitFor(() => expect(permissionSelect.value).toBe('owner'));

    // The scope toggle UI should disappear once owner is selected.
    expect(screen.queryByLabelText(/Scoped/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    await waitFor(() => expect(vi.mocked(membersApi.addMember)).toHaveBeenCalled());
    const [, body] = vi.mocked(membersApi.addMember).mock.calls[0]!;
    expect(body.permission).toBe('owner');
    expect(body.accessMode).toBe('unrestricted');
    expect(body.scopes).toBeUndefined();
  });
});

describe('MembersPanel — scope badges + edit panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(membersApi.listMembers).mockResolvedValue([
      {
        id: 'm-1',
        displayCode: 'M-1',
        userId: 'u-1',
        userCode: 'U-1',
        email: 'scoped@b.test',
        displayName: 'Scoped User',
        globalRole: 'auditor',
        permission: 'viewer',
        addedAt: new Date().toISOString(),
        scopes: [
          { scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' },
          { scopeType: 'escalation-center', functionId: null, accessLevel: 'viewer' },
        ],
      },
    ]);
    vi.mocked(membersApi.updateMember).mockResolvedValue({ id: 'm-1', displayCode: 'M-1', changed: true });
  });

  it('renders scope badges and PATCHes when the inline edit panel is saved', async () => {
    renderPanel();

    expect(await screen.findByText(/Master Data · viewer/)).toBeInTheDocument();
    expect(screen.getByText(/Escalation Center · viewer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Edit access/ }));
    // Save with the existing scoped state — should still PATCH.
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(vi.mocked(membersApi.updateMember)).toHaveBeenCalled());
    const [, memberCode, body] = vi.mocked(membersApi.updateMember).mock.calls[0]!;
    expect(memberCode).toBe('M-1');
    expect(body.accessMode).toBe('scoped');
    expect(body.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeType: 'function', functionId: 'master-data' }),
        expect.objectContaining({ scopeType: 'escalation-center' }),
      ]),
    );
  });
});
