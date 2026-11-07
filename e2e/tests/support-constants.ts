// Constants shared by support.ts and global-setup.ts (kept free of Playwright test imports).
export const API_URL = process.env.API_URL ?? "http://localhost:8000";

export const ADMIN = { email: "admin@jobproof.test", password: "Admin123!", name: "Tom Ashworth" };

/** What migration 0002 inserts on an empty database with no DEFAULT_COMPANY_NAME. */
export const DEFAULT_NAME = "Arbour Services";
export const DEFAULT_THEME_COLOURS = { primary: "#1F5130", accent: "#2F5D3A" };
