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

export class UnipileClient {
  constructor(config) {
    this.config = config;
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

      // Honour Retry-After when the API sends one.
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
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

  listAccounts() {
    return this.request("/api/v1/accounts", { query: { limit: 100 } });
  }

  /**
   * One page of a LinkedIn/Sales Navigator search.
   * `cursor` goes in the query string; the search definition stays in the body.
   */
  search({ url, cursor, limit, extraBody = {} }) {
    return this.request("/api/v1/linkedin/search", {
      method: "POST",
      query: { account_id: this.config.accountId, cursor, limit },
      body: { url, ...extraBody },
    });
  }
}
