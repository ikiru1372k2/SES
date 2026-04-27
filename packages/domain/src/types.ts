/**
 * Backward-compatible barrel — all types now live under types/.
 * Existing importers (`from '@ses/domain'` or `from '..../types'`) continue to work.
 */
export * from './types/index';
