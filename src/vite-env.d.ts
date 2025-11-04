/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GPX_ROUTE?: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
