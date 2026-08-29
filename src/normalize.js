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

function formatHqLocation(hq) {
  if (!hq || typeof hq !== "object") return null;
  const street = Array.isArray(hq.street)
    ? hq.street.filter(Boolean).join(", ")
    : hq.street;
  return [street, hq.city, hq.area, hq.postal_code, hq.country].filter(Boolean).join(", ") || null;
}

function headquarters(item) {
  const locations = item?.locations;
  if (!Array.isArray(locations) || !locations.length) return null;
  const hq = locations.find((loc) => loc?.is_headquarter) || locations[0];
  if (!hq || typeof hq !== "object") return null;
  return {
    is_headquarter: Boolean(hq.is_headquarter),
    country: hq.country ?? null,
    city: hq.city ?? null,
    postal_code: hq.postalCode ?? hq.postal_code ?? null,
    street: hq.street ?? null,
    area: hq.area ?? null,
    description: hq.description ?? null,
  };
}

function crunchbaseSummary(item) {
  const cb = item?.crunchbase_funding;
  if (!cb || typeof cb !== "object") return null;
  const last = cb.rounds?.last_round;
  return {
    company_url: cb.company_url ?? null,
    last_updated_at: cb.last_updated_at ?? null,
    rounds_count: cb.rounds?.total_count ?? null,
    last_round: last
      ? {
          announced_on: last.announced_on ?? null,
          funding_type: last.funding_type ?? null,
          money_raised: last.money_raised ?? null,
          investors_count: last.investors_count ?? null,
          url: last.url ?? null,
        }
      : null,
  };
}

function empty(value) {
  return value === undefined || value === null || value === "";
}

export function normalizeCompanyProfile(item) {
  const hq = headquarters(item);
  const industry = item?.industry;
  const insights = item?.insights?.employeesCount ?? item?.insights?.employees_count;

  return {
    id: item?.id != null ? String(item.id) : null,
    name: pick(item, ["name"]),
    tagline: pick(item, ["tagline"]),
    description: pick(item, ["description"]),
    public_identifier: pick(item, ["public_identifier", "publicIdentifier"]),
    profile_url: pick(item, ["profile_url"]),
    logo: pick(item, ["logo"]),
    website: pick(item, ["website"]),
    phone: pick(item, ["phone"]),
    industry: industry ?? null,
    organization_type: pick(item, ["organization_type"]),
    foundation_date: pick(item, ["foundation_date"]),
    employee_count: item?.employee_count ?? null,
    employee_count_range: item?.employee_count_range ?? null,
    followers_count: item?.followers_count ?? null,
    headquarters: hq,
    location: formatHqLocation(hq),
    claimed: item?.claimed ?? null,
    insights: insights
      ? {
          employees_total: insights.totalCount ?? insights.total_count ?? null,
          average_tenure: insights.averageTenure ?? insights.average_tenure ?? null,
        }
      : null,
    acquired_by: item?.acquired_by ?? null,
    crunchbase_funding: crunchbaseSummary(item),
    _raw: item,
  };
}

/**
 * Fill empty search fields from a profile, then add the extra firmographic
 * fields on the same object. Keeps the Sales Navigator `profile_url`.
 */
export function mergeCompanyProfile(item, profile) {
  const { _raw, ...fields } = profile;
  const merged = { ...item };

  if (empty(merged.website) && fields.website) merged.website = fields.website;
  if (empty(merged.location) && fields.location) merged.location = fields.location;
  if (empty(merged.headcount) && fields.employee_count != null) {
    merged.headcount = String(fields.employee_count);
  }
  if (empty(merged.summary) && fields.description) merged.summary = fields.description;
  if (empty(merged.industry) && fields.industry) {
    merged.industry = Array.isArray(fields.industry)
      ? fields.industry.join(", ")
      : fields.industry;
  }
  if (empty(merged.name) && fields.name) merged.name = fields.name;
  if (empty(merged.id) && fields.id) merged.id = fields.id;

  merged.tagline = fields.tagline ?? null;
  merged.public_identifier = fields.public_identifier ?? null;
  merged.linkedin_url = fields.profile_url ?? null;
  merged.logo = fields.logo ?? null;
  merged.phone = fields.phone ?? null;
  merged.organization_type = fields.organization_type ?? null;
  merged.foundation_date = fields.foundation_date ?? null;
  merged.employee_count = fields.employee_count ?? null;
  merged.employee_count_range = fields.employee_count_range ?? null;
  merged.followers_count = fields.followers_count ?? null;
  merged.headquarters = fields.headquarters ?? null;
  merged.claimed = fields.claimed ?? null;
  merged.insights = fields.insights ?? null;
  merged.acquired_by = fields.acquired_by ?? null;
  merged.crunchbase_funding = fields.crunchbase_funding ?? null;
  merged.description = fields.description ?? merged.summary ?? null;
  if (_raw) merged._raw_profile = _raw;
  return merged;
}

function jobCompany(item) {
  const raw = item?.company;
  if (!raw || typeof raw !== "object") return null;
  const id = pick(raw, ["id", "company_id"]);
  return {
    id: id != null ? String(id) : null,
    name: pick(raw, ["name", "company_name"]),
    public_identifier: pick(raw, ["public_identifier", "publicIdentifier"]),
    profile_url: pick(raw, ["profile_url", "url", "linkedin_url"]),
  };
}

export function jobKey(job) {
  return job.id || job.url || "";
}

export function normalizeJob(item) {
  const company = jobCompany(item);
  const workplace = pick(item, ["workplace_type", "presence", "work_type"]);
  const insights = item?.insights;
  const id = pick(item, ["id", "reference_id"]);

  return {
    id: id != null ? String(id) : null,
    title: pick(item, ["title", "job_title", "name"]),
    location: pick(item, ["location"]),
    url: pick(item, ["url", "job_url", "linkedin_url"]),
    posted_at: pick(item, ["posted_at", "listed_at", "created_at"]),
    workplace_type: Array.isArray(workplace) ? workplace[0] ?? null : workplace,
    easy_apply: item?.easy_apply ?? null,
    is_repost: item?.is_repost ?? item?.reposted ?? null,
    is_promoted: item?.is_promoted ?? item?.promoted ?? null,
    few_applicants: item?.few_applicants ?? null,
    benefits: Array.isArray(item?.benefits) ? item.benefits : null,
    insights: Array.isArray(insights) ? insights : null,
    company,
    _raw: item,
  };
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
