/** When `true`, restores the per-tile Tracking tab (Kanban) for one release cycle. */
export function isLegacyTileTrackingTabEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_LEGACY_TILE_TRACKING_TAB === 'true';
}
