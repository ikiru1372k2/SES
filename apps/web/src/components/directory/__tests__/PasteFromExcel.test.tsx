import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PasteFromExcel } from '../PasteFromExcel';

describe('PasteFromExcel', () => {
  it('parses TSV and emits directory rows', async () => {
    const user = userEvent.setup();
    const onParsed = vi.fn();
    render(<PasteFromExcel onParsed={onParsed} />);

    const text =
      'First Name\tLast Name\tEmail\n' + 'Ann\tTester\tann.tester+' + Date.now() + '@example.com\n';
    await user.type(screen.getByRole('textbox'), text);
    await user.click(screen.getByRole('button', { name: 'Parse' }));

    expect(onParsed).toHaveBeenCalledTimes(1);
    const rows = onParsed.mock.calls[0]![0] as Array<{ firstName: string; lastName: string; email: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.firstName).toBe('Ann');
    expect(rows[0]!.lastName).toBe('Tester');
    expect(rows[0]!.email).toContain('@example.com');
  });

  it('shows an error when headers cannot be mapped', async () => {
    const user = userEvent.setup();
    render(<PasteFromExcel onParsed={vi.fn()} />);
    await user.type(screen.getByRole('textbox'), 'A\tB\tC\n1\t2\t3\n');
    await user.click(screen.getByRole('button', { name: 'Parse' }));
    expect(screen.getByText(/Could not detect first name/i)).toBeInTheDocument();
  });
});
