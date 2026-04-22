/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_TILES_DASHBOARD?: string;
  /** When `true`, restores the per-tile Tracking (Kanban) tab in the function workspace. */
  readonly VITE_FEATURE_LEGACY_TILE_TRACKING_TAB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
