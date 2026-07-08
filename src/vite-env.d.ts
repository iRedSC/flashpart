/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ENV?: string;
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
