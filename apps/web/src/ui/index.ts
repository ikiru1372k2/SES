/**
 * ui/ — root barrel.
 *
 * Exports all primitives, layout, and feature-level components from one
 * entry point. Import directly from sub-paths for tree-shaking.
 */
export * from './primitives/index';
export * from './layout/index';
export * from './features/dashboard/index';
export * from './features/workspace/index';
export * from './features/escalation/index';
export * from './features/ai-pilot/index';
export * from './features/directory/index';
export * from './features/notifications/index';
