import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Crawlers that fetch a URL the moment it is pasted into a chat. */
const LINK_PREVIEW_BOTS =
  /facebookexternalhit|whatsapp|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|skypeuripreview|bingbot|googlebot|applebot|embedly|redditbot/i;

/** Every path the hook serves over GET. Anything else is a 404. */
const GET_ROUTES = new Set(["/", "/connect", "/go", "/done", "/failed"]);

export function expiresOnFromHours(hours) {
  const n = Number(hours);
  const h = Number.isFinite(n) && n > 0 ? n : 2;
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

export function parseProviders(raw) {
  if (raw == null || raw === "") return ["LINKEDIN"];
  const list = String(raw)
    .split(/[,\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : ["LINKEDIN"];
}

export function hostedAuthUrl(response) {
  return response?.url || response?.link || null;
}

export async function mintConnectUrl(client, options = {}) {
  const {
    providers,
    hours,
    name,
    notifyUrl,
    successRedirectUrl,
    failureRedirectUrl,
  } = options;

  const data = await client.createHostedAuthLink({
    providers: providers ?? ["LINKEDIN"],
    expiresOn: expiresOnFromHours(hours),
    name,
    notifyUrl,
    successRedirectUrl,
    failureRedirectUrl,
  });

  const url = hostedAuthUrl(data);
  if (!url) throw new Error("Unipile did not return a hosted auth URL.");
  return url;
}

/** The URL a colleague opens. Never the Unipile wizard itself. */
export function shareUrl({ origin, token }) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = `${base}/connect`;
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}

export function whatsappText(url, label) {
  const who = label ? `Hi ${label}! ` : "";
  return (
    `${who}Please connect your LinkedIn so we can run Sales Navigator searches from your seat. ` +
    `Open this and follow the steps:\n${url}`
  );
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f5f7; color: #1c1e21;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border-radius: 16px; padding: 32px 28px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.06); text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
  p { margin: 0 0 20px; color: #5c6470; }
  p:last-child { margin-bottom: 0; }
  .btn {
    display: block; padding: 15px 20px; border-radius: 10px; background: #0a66c2; color: #fff;
    font-size: 17px; font-weight: 600; text-decoration: none;
  }
  .btn:active { background: #084e96; }
  .note { margin-top: 18px; font-size: 13px; color: #8a919c; }
  .mark { font-size: 40px; line-height: 1; margin-bottom: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e8eaed; }
    .card { background: #22252a; box-shadow: none; }
    p { color: #a8b0ba; }
    .note { color: #767d87; }
  }
`;

function page(title, bodyHtml, { head = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
${head}
<style>${STYLE}</style>
</head>
<body><main class="card">${bodyHtml}</main></body>
</html>
`;
}

/**
 * Shown to whoever opens the shared link. Deliberately static: minting only
 * happens on /go, so a chat app's link-preview fetch cannot burn a wizard URL.
 */
export function landingPage({ goHref, providerLabel = "LinkedIn" }) {
  const head = `<meta property="og:title" content="Connect your ${escapeHtml(providerLabel)} account">
<meta property="og:description" content="Secure one-time setup. Takes about a minute.">
<meta property="og:type" content="website">`;
  return page(
    `Connect your ${providerLabel} account`,
    `<div class="mark">&#128279;</div>
    <h1>Connect your ${escapeHtml(providerLabel)} account</h1>
    <p>You will be taken to a secure setup page to sign in. It takes about a minute.</p>
    <a class="btn" href="${escapeHtml(goHref)}" rel="nofollow">Continue</a>
    <p class="note">Your password is entered on the provider&#39;s own page and is never shared with the sender.</p>`,
    { head },
  );
}

export function donePage() {
  return page(
    "You are connected",
    `<div class="mark">&#9989;</div>
    <h1>You are connected</h1>
    <p>Thanks &mdash; the account is linked. You can close this page.</p>`,
  );
}

export function failedPage() {
  return page(
    "Connection failed",
    `<div class="mark">&#9888;&#65039;</div>
    <h1>That did not go through</h1>
    <p>The setup was cancelled or timed out. Open the original link again to retry.</p>`,
  );
}

export function errorPage(message) {
  return page(
    "Something went wrong",
    `<div class="mark">&#9888;&#65039;</div>
    <h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>`,
  );
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

/** Read a webhook body, refusing anything implausibly large. */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** One JSON line per webhook, so you keep a record of who connected when. */
export function appendConnectionLog(path, payload) {
  const row = {
    at: new Date().toISOString(),
    status: payload?.status ?? null,
    account_id: payload?.account_id ?? null,
    name: payload?.name ?? null,
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n", "utf8");
  return row;
}

function titleCase(value) {
  const text = String(value).toLowerCase();
  if (text === "linkedin") return "LinkedIn";
  if (text === "whatsapp") return "WhatsApp";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Local hook a colleague reaches through a tunnel. The public origin is not
 * known until the tunnel is up, so it is injected afterwards via setOrigin.
 */
export function startConnectHook({
  client,
  port,
  token,
  hours,
  providers,
  label,
  notifySecret,
  onConnected,
  onEvent,
}) {
  let origin = `http://localhost:${port}`;
  const notifyPath = `/notify/${notifySecret}`;
  const providerLabel = providers?.length === 1 ? titleCase(providers[0]) : "account";

  const server = createServer(async (req, res) => {
    let parsed;
    try {
      parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      send(res, 400, errorPage("Invalid request URL."));
      return;
    }

    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const method = req.method || "GET";

    if (path === notifyPath) {
      if (method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      let payload = null;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        payload = null;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      if (payload) onConnected?.(payload);
      return;
    }

    // Unknown paths are 404 whatever the method, so probing /notify/<guess>
    // cannot be distinguished from any other dead URL.
    if (!GET_ROUTES.has(path)) {
      send(res, 404, errorPage("Not found."));
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end();
      return;
    }

    if (path === "/done") {
      send(res, 200, donePage());
      return;
    }
    if (path === "/failed") {
      send(res, 200, failedPage());
      return;
    }

    if (token && parsed.searchParams.get("t") !== token) {
      send(
        res,
        403,
        errorPage("This link is missing its access token. Ask the sender to resend it."),
      );
      return;
    }

    const goHref = token ? `/go?t=${encodeURIComponent(token)}` : "/go";

    if (path !== "/go") {
      send(res, 200, landingPage({ goHref, providerLabel }));
      return;
    }

    // A preview crawler that follows /go anyway gets the landing page, not a
    // freshly minted single-use wizard link.
    if (LINK_PREVIEW_BOTS.test(req.headers["user-agent"] || "")) {
      send(res, 200, landingPage({ goHref, providerLabel }));
      return;
    }

    try {
      const wizard = await mintConnectUrl(client, {
        providers,
        hours,
        name: label || undefined,
        notifyUrl: `${origin}${notifyPath}`,
        successRedirectUrl: `${origin}/done`,
        failureRedirectUrl: `${origin}/failed`,
      });
      onEvent?.("Minted a fresh wizard link for a visitor.");
      res.writeHead(302, { location: wizard, "cache-control": "no-store" });
      res.end();
    } catch (err) {
      onEvent?.(`Mint failed: ${err.message}`);
      send(res, 502, errorPage(err.message || "Could not create a connect link."));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${port} is already in use. Pass --port with a free port.`)
          : err,
      );
    });
    server.listen(port, "0.0.0.0", () => {
      resolve({
        server,
        notifyPath,
        setOrigin(next) {
          origin = String(next).replace(/\/+$/, "");
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
