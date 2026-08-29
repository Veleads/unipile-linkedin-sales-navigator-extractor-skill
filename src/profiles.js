import { humanDelay } from "./extract.js";
import { mergeCompanyProfile, normalizeCompanyProfile } from "./normalize.js";

function stripJobRaw(job) {
  if (!job || typeof job !== "object") return job;
  const { _raw, ...rest } = job;
  return rest;
}

function stripJobs(jobs) {
  if (!Array.isArray(jobs)) return jobs;
  return jobs.map(stripJobRaw);
}

function stripItemRaw(item) {
  if (!item || typeof item !== "object") return item;
  const { _raw, _raw_profile, ...rest } = item;
  if (Array.isArray(rest.jobs)) rest.jobs = stripJobs(rest.jobs);
  if (rest.company_profile && typeof rest.company_profile === "object") {
    const { _raw: innerRaw, ...profile } = rest.company_profile;
    if (Array.isArray(profile.jobs)) profile.jobs = stripJobs(profile.jobs);
    rest.company_profile = profile;
  }
  return rest;
}

export function withoutRaw(item) {
  return stripItemRaw(item);
}

/**
 * Accept a numeric id, public slug, URN, or a LinkedIn / Sales Navigator URL.
 */
export function parseCompanyIdentifier(idOrUrl) {
  if (idOrUrl == null) return null;
  const raw = String(idOrUrl).trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const sales = url.pathname.match(/\/sales\/company\/([^/]+)/i);
    if (sales) return decodeURIComponent(sales[1]);
    const company = url.pathname.match(/\/company\/([^/]+)/i);
    if (company) return decodeURIComponent(company[1]);
  } catch {
    return raw;
  }

  return raw;
}

export function identifierFromCompanyItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.id) return String(item.id);
  if (item.public_identifier) return String(item.public_identifier);
  return parseCompanyIdentifier(item.profile_url || item.linkedin_url || item.url);
}

async function fetchNormalizedProfile(client, identifier) {
  const raw = await client.getCompanyProfile(identifier);
  return normalizeCompanyProfile(raw);
}

export async function enrichCompanies({
  client,
  config,
  items,
  includeRaw,
  onProgress,
}) {
  const result = [];
  let failed = 0;
  let first = true;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const identifier = identifierFromCompanyItem(item);
    if (!identifier) {
      failed += 1;
      result.push({ ...item, profile_error: "No company id or profile URL" });
      onProgress?.({ index: i + 1, total: items.length, identifier: null, ok: false });
      continue;
    }

    await humanDelay(config, { first });
    first = false;

    try {
      const profile = await fetchNormalizedProfile(client, identifier);
      const merged = mergeCompanyProfile(item, profile);
      result.push(includeRaw ? merged : withoutRaw(merged));
      onProgress?.({ index: i + 1, total: items.length, identifier, ok: true });
    } catch (err) {
      failed += 1;
      result.push({
        ...(includeRaw ? item : withoutRaw(item)),
        profile_error: err.message || String(err),
      });
      onProgress?.({
        index: i + 1,
        total: items.length,
        identifier,
        ok: false,
        error: err.message,
      });
    }
  }

  return { items: result, requested: items.length, failed, skipped: 0 };
}

export async function enrichPeople({
  client,
  config,
  items,
  includeRaw,
  onProgress,
}) {
  const uniqueIds = [];
  const seen = new Set();
  for (const person of items) {
    const id = person?.company_id != null ? String(person.company_id) : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }

  const profiles = new Map();
  const errors = new Map();
  let first = true;

  for (let i = 0; i < uniqueIds.length; i++) {
    const identifier = uniqueIds[i];
    await humanDelay(config, { first });
    first = false;

    try {
      const profile = await fetchNormalizedProfile(client, identifier);
      profiles.set(identifier, includeRaw ? profile : withoutRaw(profile));
      onProgress?.({ index: i + 1, total: uniqueIds.length, identifier, ok: true });
    } catch (err) {
      errors.set(identifier, err.message || String(err));
      onProgress?.({
        index: i + 1,
        total: uniqueIds.length,
        identifier,
        ok: false,
        error: err.message,
      });
    }
  }

  let skipped = 0;
  const result = items.map((person) => {
    const base = includeRaw ? { ...person } : withoutRaw(person);
    const id = person?.company_id != null ? String(person.company_id) : null;
    if (!id) {
      skipped += 1;
      return base;
    }
    if (errors.has(id)) {
      return { ...base, profile_error: errors.get(id) };
    }
    return { ...base, company_profile: profiles.get(id) ?? null };
  });

  return {
    items: result,
    requested: uniqueIds.length,
    failed: errors.size,
    skipped,
  };
}

export async function enrichFromExtract({
  client,
  config,
  envelope,
  includeRaw,
  onProgress,
}) {
  const kind = envelope?.kind;
  const items = Array.isArray(envelope?.items) ? envelope.items : [];
  if (kind === "companies") {
    return { kind, ...(await enrichCompanies({ client, config, items, includeRaw, onProgress })) };
  }
  if (kind === "people") {
    return { kind, ...(await enrichPeople({ client, config, items, includeRaw, onProgress })) };
  }
  throw new Error(
    `Unsupported extract kind ${JSON.stringify(kind)}. Expected "companies" or "people".`,
  );
}

export async function fetchOneProfile({ client, config, identifier, includeRaw }) {
  await humanDelay(config, { first: true });
  const profile = await fetchNormalizedProfile(client, identifier);
  return includeRaw ? profile : withoutRaw(profile);
}
