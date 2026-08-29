import { humanDelay } from "./extract.js";
import { jobKey, normalizeJob } from "./normalize.js";
import { identifierFromCompanyItem, parseCompanyIdentifier, withoutRaw } from "./profiles.js";

/**
 * Classic job search `company[]` only accepts numeric LinkedIn company ids.
 */
export function numericCompanyId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;

  const urn = raw.match(/urn:li:(?:organization|company):(\d+)/i);
  if (urn) return urn[1];

  const parsed = parseCompanyIdentifier(raw);
  if (parsed && /^\d+$/.test(parsed)) return parsed;
  return null;
}

export function numericIdFromCompanyItem(item) {
  if (!item || typeof item !== "object") return null;
  return (
    numericCompanyId(item.id) ||
    numericCompanyId(item.company_id) ||
    numericCompanyId(identifierFromCompanyItem(item))
  );
}

function pageItems(page) {
  if (Array.isArray(page?.items)) return page.items;
  if (Array.isArray(page?.data)) return page.data;
  return [];
}

function stripJob(job, includeRaw) {
  if (includeRaw) return job;
  const { _raw, ...rest } = job;
  return rest;
}

export async function fetchJobsForCompany({
  client,
  config,
  companyId,
  count,
  includeRaw,
  onPage,
}) {
  const limit = config.jobPageLimit ?? 50;
  const target = count ?? Infinity;
  const seen = new Set();
  const jobs = [];
  let cursor;
  let pages = 0;
  let totalCount = null;

  while (jobs.length < target) {
    await humanDelay(config, { first: pages === 0 });

    const page = await client.searchJobs({ companyId, cursor, limit });
    pages += 1;

    const rawItems = pageItems(page);
    if (totalCount == null) {
      totalCount = page?.paging?.total_count ?? page?.total_count ?? null;
    }

    for (const raw of rawItems) {
      if (jobs.length >= target) break;
      const job = normalizeJob(raw);
      const key = jobKey(job);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      jobs.push(stripJob(job, includeRaw));
    }

    onPage?.({
      pages,
      pageSize: rawItems.length,
      jobs: jobs.length,
      totalCount,
    });

    const next = page?.cursor || page?.next_cursor || null;
    if (!rawItems.length || !next || jobs.length >= target) break;
    cursor = next;
  }

  return { jobs, pages, totalCount };
}

function idForItem(kind, item) {
  if (kind === "people") return numericCompanyId(item?.company_id);
  return numericIdFromCompanyItem(item);
}

function attachJobsToItem(kind, item, jobs, error) {
  if (kind === "people" && item.company_profile && typeof item.company_profile === "object") {
    if (error) {
      return { ...item, company_profile: { ...item.company_profile, jobs_error: error } };
    }
    return { ...item, company_profile: { ...item.company_profile, jobs } };
  }
  if (error) return { ...item, jobs_error: error };
  return { ...item, jobs };
}

export async function attachJobs({
  client,
  config,
  envelope,
  count,
  includeRaw,
  onProgress,
}) {
  const kind = envelope?.kind;
  const items = Array.isArray(envelope?.items) ? envelope.items : [];

  if (kind !== "companies" && kind !== "company_profile" && kind !== "people") {
    throw new Error(
      `Unsupported JSON kind ${JSON.stringify(kind)}. Expected "companies", "company_profile", or "people".`,
    );
  }

  const uniqueIds = [];
  const seen = new Set();
  for (const item of items) {
    const id = idForItem(kind, item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }

  const cache = new Map();
  for (let i = 0; i < uniqueIds.length; i++) {
    const companyId = uniqueIds[i];
    try {
      const { jobs, pages, totalCount } = await fetchJobsForCompany({
        client,
        config,
        companyId,
        count,
        includeRaw,
        onPage({ pages: pageNum, pageSize, jobs: jobCount, totalCount: total }) {
          const totalLabel = total == null ? "?" : total;
          console.error(
            `    ${companyId} page ${pageNum}: +${pageSize} from Unipile, ${jobCount} unique (search has ${totalLabel})`,
          );
        },
      });
      cache.set(companyId, { jobs, pages, totalCount });
      onProgress?.({
        index: i + 1,
        total: uniqueIds.length,
        companyId,
        ok: true,
        jobCount: jobs.length,
      });
    } catch (err) {
      cache.set(companyId, { error: err.message || String(err) });
      onProgress?.({
        index: i + 1,
        total: uniqueIds.length,
        companyId,
        ok: false,
        error: err.message,
      });
    }
  }

  let skipped = 0;
  const result = items.map((item) => {
    const base = includeRaw ? { ...item } : withoutRaw(item);
    const id = idForItem(kind, item);
    if (!id) {
      skipped += 1;
      return base;
    }
    const entry = cache.get(id);
    if (entry?.error) return attachJobsToItem(kind, base, [], entry.error);
    return attachJobsToItem(kind, base, entry?.jobs ?? [], null);
  });

  let jobsReturned = 0;
  let failed = 0;
  for (const companyId of uniqueIds) {
    const entry = cache.get(companyId);
    if (entry?.error) failed += 1;
    else jobsReturned += entry?.jobs?.length ?? 0;
  }

  return {
    kind,
    items: result,
    requested: uniqueIds.length,
    failed,
    skipped,
    jobs_returned: jobsReturned,
  };
}
