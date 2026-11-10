/** Seven days (design 3.3). Older caches are discarded on restore. Kept free of native imports so any test can load it. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
