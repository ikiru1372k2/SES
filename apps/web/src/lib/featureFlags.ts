/** When `true`, restores the per-tile Tracking tab (Kanban) for one release cycle. */
export function isLegacyTileTrackingTabEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_LEGACY_TILE_TRACKING_TAB === 'true';
}

/**
 * Controls whether the unified 3-zone header rendered by TopBar + AppShell is
 * active. Set `VITE_NEW_HEADER=false` to fall back to the legacy TopBar.
 * Default is ON. Kept as a kill switch until Phase 4 QA sign-off.
 */
export function isNewHeaderEnabled(): boolean {
  return import.meta.env.VITE_NEW_HEADER !== 'false';
}
