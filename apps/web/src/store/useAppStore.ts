/**
 * Backward-compatibility shim.
 *
 * The monolithic store has been split into slice files under store/slices/.
 * The composed store now lives in store/index.ts.
 *
 * This file re-exports everything from the new index so all existing
 * imports (`from '…/store/useAppStore'`) continue to work without change.
 */
export { useAppStore } from './index';
export type { AppStore, UploadState } from './types';
