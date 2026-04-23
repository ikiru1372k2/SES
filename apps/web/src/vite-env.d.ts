/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_TILES_DASHBOARD?: string;
  /** When `true`, restores the per-tile Tracking (Kanban) tab in the function workspace. */
  readonly VITE_FEATURE_LEGACY_TILE_TRACKING_TAB?: string;
  /** Kill switch for the unified 3-zone header. Set to `false` to use the legacy TopBar. Default on. */
  readonly VITE_NEW_HEADER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
