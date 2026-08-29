import { sleep } from "./unipile.js";
import {
  companyKey,
  detectSearchKind,
  leadKey,
  normalizeCompany,
  normalizeLead,
} from "./normalize.js";

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Pause like a person scrolling Sales Navigator.
 * First call of a run is short; later calls pick DELAY_MIN–DELAY_MAX,
 * with an occasional extra "reading" pause.
 */
export async function humanDelay(config, { first = false } = {}) {
  let ms;
  if (first) {
    ms = randInt(400, 1200);
  } else {
    ms = randInt(config.delayMinMs, config.delayMaxMs);
    if (Math.random() < 0.12) ms += randInt(4000, 10000);
  }

  const secs = (ms / 1000).toFixed(1);
  console.error(`  waiting ${secs}s…`);
  await sleep(ms);
}

export async function extract({ client, config, url, count, onProgress }) {
  const kind = detectSearchKind(url);
  const normalize = kind === "people" ? normalizeLead : normalizeCompany;
  const keyOf = kind === "people" ? leadKey : companyKey;
  const limit = config.pageLimit ?? 100;
  const target = count ?? Infinity;
  const requested = count ?? null;

  const seen = new Set();
  const items = [];
  let cursor;
  let pages = 0;
  let totalCount = null;

  while (items.length < target) {
    await humanDelay(config, { first: pages === 0 });

    const page = await client.search({ url, cursor, limit });
    pages += 1;

    const pageItems = Array.isArray(page?.items)
      ? page.items
      : Array.isArray(page?.data)
        ? page.data
        : [];

    if (totalCount == null) {
      totalCount = page?.paging?.total_count ?? page?.total_count ?? null;
    }

    let added = 0;
    for (const raw of pageItems) {
      if (items.length >= target) break;
      const item = normalize(raw);
      const key = keyOf(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      added += 1;
    }

    onProgress?.({
      kind,
      pages,
      returned: items.length,
      requested,
      totalCount,
      added,
      pageSize: pageItems.length,
    });

    const next = page?.cursor || page?.next_cursor || null;
    if (!pageItems.length || !next || items.length >= target) break;
    cursor = next;
  }

  return { kind, items, requested, totalCount, pages };
}
