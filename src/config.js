import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimal .env reader so the project stays dependency-free.
 * Real process env always wins over the file.
 */
function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

/** Strip a scheme and any trailing slash so the DSN is safe to interpolate. */
function normalizeDsn(dsn) {
  return dsn.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function getConfig() {
  const missing = [];
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  const dsn = process.env.UNIPILE_DSN?.trim();

  if (!apiKey) missing.push("UNIPILE_API_KEY");
  if (!dsn) missing.push("UNIPILE_DSN");

  if (missing.length) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}.\n` +
        `Copy .env.example to .env and fill them in.`,
    );
  }

  return {
    apiKey,
    baseUrl: `https://${normalizeDsn(dsn)}`,
    // Pause between pages. LinkedIn throttles aggressive pagination.
    delayMinMs: Number(process.env.DELAY_MIN_MS ?? 2500),
    delayMaxMs: Number(process.env.DELAY_MAX_MS ?? 6500),
    maxRetries: Number(process.env.MAX_RETRIES ?? 4),
    pageLimit: 100,
    jobPageLimit: 50,
    // Classic job search defaults to the acting account's location.
    // "Worldwide" keeps a company's postings visible regardless of seat country.
    jobRegion: process.env.JOB_REGION?.trim() || "92000000",
    outputDir: process.env.OUTPUT_DIR?.trim() || join(ROOT, "output"),
  };
}
