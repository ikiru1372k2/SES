import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <Modal open title="Test dialog" description="A description" onClose={onClose}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </Modal>
  );
}

describe('Modal', () => {
  it('wires aria-labelledby/aria-describedby to the title and description', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    const labelledby = dialog.getAttribute('aria-labelledby');
    const describedby = dialog.getAttribute('aria-describedby');
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    expect(document.getElementById(labelledby as string)).toHaveTextContent('Test dialog');
    expect(document.getElementById(describedby as string)).toHaveTextContent('A description');
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the dialog (last -> first)', () => {
    render(<Harness />);
    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: 'Tab' });
    // Wrapping moves focus to the first focusable (the close button).
    expect(document.activeElement).not.toBe(last);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    render(<Harness />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    closeBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(closeBtn);
  });
});
