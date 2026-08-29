/**
 * Unipile's search items vary in shape between the classic and sales_navigator
 * APIs, and between LinkedIn's own A/B'd payloads. Rather than binding to one
 * spelling, every field is resolved from a list of candidate paths and the
 * untouched item is kept as `_raw` so nothing is ever lost.
 */

function get(obj, path) {
  return path
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function pick(item, paths) {
  for (const path of paths) {
    const value = get(item, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

/** Current position lives in a few different places depending on the API. */
function currentPosition(item) {
  const candidates =
    pick(item, ["current_positions", "current_position", "positions", "experience"]) ?? [];
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const first = list.find(Boolean);
  if (!first || typeof first !== "object") return {};

  return {
    company: pick(first, ["company", "company_name", "companyName", "organization"]),
    companyId: pick(first, ["company_id", "companyId", "company_urn"]),
    title: pick(first, ["role", "title", "position", "job_title"]),
    location: pick(first, ["location", "geo_region"]),
  };
}

function profileUrl(item) {
  const direct = pick(item, [
    "public_profile_url",
    "profile_url",
    "public_url",
    "linkedin_url",
    "url",
  ]);
  if (direct) return direct;

  const publicId = pick(item, ["public_identifier", "publicIdentifier"]);
  return publicId ? `https://www.linkedin.com/in/${publicId}` : null;
}

function fullName(item) {
  const name = pick(item, ["name", "full_name", "fullName", "display_name"]);
  if (name) return name;

  const first = pick(item, ["first_name", "firstName"]);
  const last = pick(item, ["last_name", "lastName"]);
  return [first, last].filter(Boolean).join(" ") || null;
}

export function normalizeLead(item) {
  const position = currentPosition(item);

  return {
    name: fullName(item),
    first_name: pick(item, ["first_name", "firstName"]),
    last_name: pick(item, ["last_name", "lastName"]),
    headline: pick(item, ["headline", "summary", "title"]),
    location: pick(item, ["location", "geo_region", "region", "address"]),
    company: position.company ?? pick(item, ["company", "company_name"]),
    job_title: position.title ?? pick(item, ["role", "job_title"]),
    company_id: position.companyId ?? null,
    industry: pick(item, ["industry", "industry_name"]),
    profile_url: profileUrl(item),
    public_identifier: pick(item, ["public_identifier", "publicIdentifier"]),
    provider_id: pick(item, ["id", "member_id", "provider_id", "entity_urn"]),
    network_distance: pick(item, ["network_distance", "connection_degree", "distance"]),
    connections_count: pick(item, ["connections_count", "connectionsCount"]),
    shared_connections_count: pick(item, [
      "shared_connections_count",
      "sharedConnectionsCount",
    ]),
    is_premium: pick(item, ["premium", "is_premium"]) ?? null,
    is_open_profile: pick(item, ["open_profile", "is_open_profile", "open_link"]) ?? null,
    profile_picture_url: pick(item, [
      "profile_picture_url",
      "profile_picture_url_large",
      "picture_url",
      "image_url",
    ]),
    _raw: item,
  };
}

/**
 * De-dupes on the most stable identifier available. Sales Navigator can return
 * the same person on overlapping pages when the underlying result set shifts.
 */
export function leadKey(lead) {
  return (
    lead.provider_id ||
    lead.public_identifier ||
    lead.profile_url ||
    `${lead.name ?? ""}|${lead.headline ?? ""}`
  );
}

export function normalizeCompany(item) {
  const id = pick(item, ["id", "company_id", "companyId"]);
  const profileUrl = pick(item, [
    "profile_url",
    "url",
    "linkedin_url",
    "sales_url",
    "company_url",
  ]);

  return {
    id: id != null ? String(id) : null,
    name: pick(item, ["name", "company_name", "companyName"]),
    profile_url:
      profileUrl || (id ? `https://www.linkedin.com/sales/company/${id}` : null),
    summary: pick(item, ["summary", "description", "about"]),
    industry: pick(item, ["industry", "industry_name"]),
    location: pick(item, ["location", "geo_region", "region", "headquarters"]),
    headcount: pick(item, ["headcount", "employee_count", "staff_count", "employees"]),
    website: pick(item, ["website", "website_url", "domain"]),
    _raw: item,
  };
}

export function companyKey(company) {
  return company.id || company.profile_url || company.name || "";
}

const PEOPLE_PATH = /\/sales\/search\/people\/?$/i;
const COMPANY_PATH = /\/sales\/search\/compan(?:y|ies)\/?$/i;

/**
 * Infer people vs companies from a Sales Navigator search URL.
 * Throws with the accepted patterns if the URL is not one of those.
 */
export function detectSearchKind(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (PEOPLE_PATH.test(path)) return "people";
  if (COMPANY_PATH.test(path)) return "companies";

  throw new Error(
    `URL must be a Sales Navigator people or company search.\n` +
      `Accepted patterns:\n` +
      `  https://www.linkedin.com/sales/search/people?...\n` +
      `  https://www.linkedin.com/sales/search/company?...`,
  );
}
