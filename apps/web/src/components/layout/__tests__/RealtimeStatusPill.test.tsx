import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeStatusPill } from '../RealtimeStatusPill';

const unsubscribe = vi.fn();
const onConnectionState = vi.fn<(listener: unknown) => () => void>(() => unsubscribe);

vi.mock('../../../realtime/socket', () => ({
  getConnectionState: () => 'connecting',
  onConnectionState: (listener: unknown) => onConnectionState(listener),
}));

describe('RealtimeStatusPill', () => {
  afterEach(() => {
    unsubscribe.mockClear();
    onConnectionState.mockClear();
  });

  it('unsubscribes from connection state updates on unmount', () => {
    const view = render(<RealtimeStatusPill />);
    expect(onConnectionState).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
