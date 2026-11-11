import type { MiniMailApi } from "@shared/api";

import { createDemoApi } from "./demo";

/**
 * The backend the UI talks to. Inside Electron the preload script provides the
 * real one; in a plain browser (`npm run dev:web`) we fall back to demo data so
 * the interface can be developed and previewed without any account.
 */
export const api: MiniMailApi = window.minimail ?? createDemoApi();
