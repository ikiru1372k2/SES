/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_TILES_DASHBOARD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
