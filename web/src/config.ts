export interface RuntimeConfig {
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __JOBPROOF_CONFIG__?: Partial<RuntimeConfig>;
  }
}

/** Reads the runtime config written by /config.js. Nothing environment-specific is bundled. */
export function readRuntimeConfig(win: Window = window): RuntimeConfig {
  const apiBaseUrl = win.__JOBPROOF_CONFIG__?.apiBaseUrl;
  if (typeof apiBaseUrl !== "string" || apiBaseUrl.trim() === "") {
    throw new Error("Missing runtime config: /config.js did not set apiBaseUrl.");
  }
  return { apiBaseUrl: apiBaseUrl.trim() };
}
