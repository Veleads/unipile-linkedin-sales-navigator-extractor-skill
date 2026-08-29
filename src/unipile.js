export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UnipileError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "UnipileError";
    this.status = status;
    this.body = body;
  }
}

/** 429 and 5xx are worth retrying; 4xx client errors are not. */
const isRetryable = (status) => status === 429 || (status >= 500 && status < 600);

export function isLinkedInAccount(account) {
  const type = String(account?.type ?? account?.provider ?? "").toUpperCase();
  return type === "LINKEDIN";
}

export function isConnectedAccount(account) {
  const sources = account?.sources;
  if (!Array.isArray(sources) || sources.length === 0) return true;
  return sources.some((source) => String(source?.status ?? "").toUpperCase() === "OK");
}

export function hasSalesNavigator(account) {
  const features =
    account?.connection_params?.im?.premiumFeatures ??
    account?.connection_params?.im?.premium_features ??
    [];
  if (!Array.isArray(features)) return false;
  return features.some((feature) => String(feature).toLowerCase() === "sales_navigator");
}

export function sourceStatusSummary(account) {
  const sources = Array.isArray(account?.sources) ? account.sources : [];
  if (!sources.length) return "unknown";
  const statuses = [...new Set(sources.map((source) => source?.status).filter(Boolean))];
  return statuses.join(",") || "unknown";
}

function accountSpecificError(err) {
  if (!(err instanceof UnipileError)) return false;
  const status = err.status;
  if (status === 401 || status === 403) return true;
  if (status === 404 || status === 429 || (status >= 500 && status < 600)) return false;
  if (status && status >= 400 && status < 500) {
    const body =
      typeof err.body === "string" ? err.body : JSON.stringify(err.body ?? "");
    const text = `${err.message} ${body}`.toLowerCase();
    return /disconnected|not connected|reconnect|sales.?navigator|invalid.?account|account.*(invalid|disabled|expired|stopped|not found)|source.*(stopped|error|credentials)/.test(
      text,
    );
  }
  return false;
}

export class UnipileClient {
  constructor(config) {
    this.config = config;
    this.linkedinAccounts = [];
    this.searchIndex = 0;
    this.profileIndex = 0;
    this.accountsLoaded = false;
    this.didLogPools = false;
    this.lastSuccessfulSearchAccountId = null;
  }

  async request(path, { method = "GET", query = {}, body } = {}) {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const headers = {
      "X-API-KEY": this.config.apiKey,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    let lastError;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        // Network-level failure: retry with backoff.
        lastError = new UnipileError(`Network error calling ${path}: ${cause.message}`);
        if (attempt === this.config.maxRetries) throw lastError;
        await sleep(this.backoffMs(attempt));
        continue;
      }

      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }

      if (response.ok) return parsed;

      const detail =
        (parsed && (parsed.detail || parsed.message || parsed.title)) ||
        (typeof parsed === "string" ? parsed.slice(0, 300) : "") ||
        response.statusText;
      lastError = new UnipileError(`Unipile ${response.status} on ${path}: ${detail}`, {
        status: response.status,
        body: parsed,
      });

      if (!isRetryable(response.status) || attempt === this.config.maxRetries) {
        throw lastError;
      }

      // Honour Retry-After when the API sends one. Stay on the same account.
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : this.backoffMs(attempt);
      console.warn(
        `  ! ${response.status} from Unipile, retrying in ${Math.round(waitMs / 1000)}s ` +
          `(attempt ${attempt + 1}/${this.config.maxRetries})`,
      );
      await sleep(waitMs);
    }

    throw lastError;
  }

  backoffMs(attempt) {
    // 2s, 4s, 8s, 16s ... plus jitter to avoid lockstep retries.
    return 2000 * 2 ** attempt + Math.floor(Math.random() * 500);
  }

  listAccounts({ cursor, limit = 100 } = {}) {
    return this.request("/api/v1/accounts", { query: { limit, cursor } });
  }

  async fetchAllAccounts() {
    const items = [];
    let cursor;
    do {
      const data = await this.listAccounts({ cursor, limit: 100 });
      const page = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      items.push(...page);
      cursor = data?.cursor || data?.next_cursor || null;
      if (!page.length) break;
    } while (cursor);
    return items;
  }

  async ensureLinkedInAccounts() {
    if (this.accountsLoaded) return this.linkedinAccounts;

    const items = await this.fetchAllAccounts();
    this.linkedinAccounts = items
      .filter(isLinkedInAccount)
      .filter(isConnectedAccount)
      .map((account) => ({
        id: account.id ?? account.account_id,
        name: account.name ?? account.display_name ?? "",
        hasSalesNavigator: hasSalesNavigator(account),
        skipped: false,
      }))
      .filter((account) => account.id);

    if (!this.linkedinAccounts.length) {
      throw new Error(
        "No connected LinkedIn accounts found in Unipile. Connect a LinkedIn account and retry.",
      );
    }

    this.accountsLoaded = true;
    this.logAccountPools();
    return this.linkedinAccounts;
  }

  logAccountPools() {
    if (this.didLogPools) return;
    this.didLogPools = true;
    const connected = this.activeAccounts();
    const sn = connected.filter((account) => account.hasSalesNavigator);
    const searchNote = sn.length
      ? `Search will round-robin ${sn.length} Sales Navigator seat(s)`
      : `Search will round-robin all ${connected.length} connected LinkedIn account(s) (none advertised Sales Navigator)`;
    console.error(
      `LinkedIn accounts: ${connected.length} connected (${sn.length} with Sales Navigator). ` +
        `${searchNote}; company profiles will use all ${connected.length}.`,
    );
  }

  activeAccounts() {
    return this.linkedinAccounts.filter((account) => account.id && !account.skipped);
  }

  pool(kind) {
    const connected = this.activeAccounts();
    if (kind === "search") {
      const sn = connected.filter((account) => account.hasSalesNavigator);
      return sn.length ? sn : connected;
    }
    return connected;
  }

  pickAccount(kind, excludeIds = new Set()) {
    const available = this.pool(kind).filter((account) => !excludeIds.has(account.id));
    if (!available.length) return null;
    const indexKey = kind === "search" ? "searchIndex" : "profileIndex";
    const account = available[this[indexKey] % available.length];
    this[indexKey] += 1;
    return account.id;
  }

  skipAccount(accountId, reason) {
    const account = this.linkedinAccounts.find((item) => item.id === accountId);
    if (!account || account.skipped) return;
    account.skipped = true;
    console.warn(`  ! skipping account ${accountId}${reason ? `: ${reason}` : ""}`);
  }

  async withAccountRotation(kind, fn, { cursor } = {}) {
    await this.ensureLinkedInAccounts();

    const tried = new Set();
    let lastError;

    while (true) {
      const accountId = this.pickAccount(kind, tried);
      if (!accountId) break;
      tried.add(accountId);

      try {
        const result = await fn(accountId);
        if (kind === "search") this.lastSuccessfulSearchAccountId = accountId;
        return result;
      } catch (err) {
        lastError = err;
        if (accountSpecificError(err)) {
          this.skipAccount(accountId, err.message);
          continue;
        }

        const previous = this.lastSuccessfulSearchAccountId;
        if (
          kind === "search" &&
          cursor &&
          previous &&
          previous !== accountId &&
          !tried.has(previous)
        ) {
          console.warn(
            `  ! ${err.message}; retrying this page on the previous account ${previous}`,
          );
          tried.add(previous);
          try {
            const result = await fn(previous);
            this.lastSuccessfulSearchAccountId = previous;
            return result;
          } catch (retryErr) {
            lastError = retryErr;
            if (accountSpecificError(retryErr)) {
              this.skipAccount(previous, retryErr.message);
              continue;
            }
            throw retryErr;
          }
        }

        throw err;
      }
    }

    throw (
      lastError ||
      new Error("No connected LinkedIn accounts remaining to call Unipile.")
    );
  }

  /**
   * One page of a LinkedIn/Sales Navigator search.
   * `cursor` goes in the query string; the search definition stays in the body.
   */
  search({ url, cursor, limit, extraBody = {} }) {
    return this.withAccountRotation(
      "search",
      (accountId) =>
        this.request("/api/v1/linkedin/search", {
          method: "POST",
          query: { account_id: accountId, cursor, limit },
          body: { url, ...extraBody },
        }),
      { cursor },
    );
  }

  getCompanyProfile(identifier) {
    const encoded = encodeURIComponent(identifier);
    return this.withAccountRotation("profile", (accountId) =>
      this.request(`/api/v1/linkedin/company/${encoded}`, {
        query: { account_id: accountId },
      }),
    );
  }

  /**
   * One page of classic LinkedIn job search for a numeric company id.
   * Uses the profile account pool (no Sales Navigator required).
   */
  searchJobs({ companyId, cursor, limit }) {
    return this.withAccountRotation(
      "profile",
      (accountId) =>
        this.request("/api/v1/linkedin/search", {
          method: "POST",
          query: { account_id: accountId, cursor, limit },
          body: {
            api: "classic",
            category: "jobs",
            company: [String(companyId)],
            sort_by: "date",
          },
        }),
      { cursor },
    );
  }
}
