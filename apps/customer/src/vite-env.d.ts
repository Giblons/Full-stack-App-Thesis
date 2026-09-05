/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the hosted API. When unset, dev uses localhost and a static build uses in-browser demo mode. */
  readonly VITE_API_URL?: string;
  /** Legacy alias for VITE_API_URL. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
