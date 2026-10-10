/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1` serves the API from MSW in the browser (dev tooling only; tree-shaken from production builds). */
  readonly VITE_MOCK_API?: string;
  /** Override the API base path (default `/api/v1`). */
  readonly VITE_API_BASE?: string;
  /** Dev-server proxy target (read in vite.config.ts). */
  readonly VITE_BACKEND_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
