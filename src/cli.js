#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getConfig } from "./config.js";
import { extract } from "./extract.js";
import {
  appendConnectionLog,
  mintConnectUrl,
  parseProviders,
  shareUrl,
  startConnectHook,
  whatsappText,
} from "./connect.js";
import { resolveCloudflared, startTunnel } from "./tunnel.js";
import { attachJobs } from "./jobs.js";
import {
  enrichFromExtract,
  fetchOneProfile,
  parseCompanyIdentifier,
  withoutRaw,
} from "./profiles.js";
import {
  UnipileClient,
  hasSalesNavigator,
  isLinkedInAccount,
  sourceStatusSummary,
} from "./unipile.js";

function usage() {
  return `Usage:
  node src/cli.js extract --url <sales-navigator-url> [--count <n>] [--out <path>] [--include-raw]
  node src/cli.js extract <sales-navigator-url> [count]
  node src/cli.js company-profile --from <extract.json> [--out <path>] [--include-raw]
  node src/cli.js company-profile --id <company-id-or-slug> [--out <path>] [--include-raw]
  node src/cli.js jobs --from <companies-or-profiles.json> [--count <n>] [--region <geo-id>] [--out <path>] [--include-raw]
  node src/cli.js connect [--label <name>] [--hours 2] [--providers LINKEDIN]
                          [--port 8787] [--token <secret>] [--direct] [--no-tunnel]
  node src/cli.js list-accounts

connect opens a free cloudflared tunnel and prints one https URL to send over
WhatsApp. Everyone who opens it gets a freshly minted Unipile wizard, so the
link survives Unipile's daily expiry of hosted-auth URLs. It stays alive until
you stop it. Use --direct for a single raw wizard URL with no tunnel, or
--no-tunnel to run the hook behind your own tunnel (CONNECT_HOOK_PUBLIC_URL).

Omit --count on extract to fetch every page Unipile returns (LinkedIn caps Sales
Navigator people at ~2500 and companies at ~1000). On jobs, --count caps jobs
per company; omit it to paginate each company's classic job search fully.

Classic job search is location-scoped. It defaults to "Worldwide" (92000000) so a
company's postings show up regardless of the acting seat's country; pass --region
with a LinkedIn geo id to narrow (Germany is 101282230), or set JOB_REGION.

People:    https://www.linkedin.com/sales/search/people?...
Companies: https://www.linkedin.com/sales/search/company?...`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--include-raw") {
      args.includeRaw = true;
    } else if (token === "--direct") {
      args.direct = true;
    } else if (token === "--no-tunnel") {
      args.noTunnel = true;
    } else if (
      token === "--url" ||
      token === "--count" ||
      token === "--out" ||
      token === "--from" ||
      token === "--id" ||
      token === "--region" ||
      token === "--name" ||
      token === "--label" ||
      token === "--hours" ||
      token === "--port" ||
      token === "--token" ||
      token === "--providers"
    ) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${token}`);
      args[token.slice(2)] = value;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown flag: ${token}\n\n${usage()}`);
    } else {
      args._.push(token);
    }
  }
  return args;
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function parseCount(raw) {
  if (raw === undefined) return undefined;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--count must be a positive integer, got ${raw}\n\n${usage()}`);
  }
  return count;
}

function parseHours(raw) {
  if (raw === undefined) return 2;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`--hours must be a positive number, got ${raw}\n\n${usage()}`);
  }
  return hours;
}

function parsePort(raw, fallback) {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be an integer 1–65535, got ${raw}\n\n${usage()}`);
  }
  return port;
}

function readExtract(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not read extract JSON at ${path}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    throw new Error(`${path} is not an extract JSON file (missing items array).`);
  }
  return parsed;
}

async function cmdExtract(args) {
  const url = args.url || args._[0];
  const count = parseCount(args.count ?? args._[1]);

  if (!url) throw new Error(`Missing --url.\n\n${usage()}`);

  const config = getConfig();
  const client = new UnipileClient(config);
  await client.ensureLinkedInAccounts();
  const result = await extract({
    client,
    config,
    url,
    count,
    onProgress({ pages, returned, requested, totalCount, pageSize }) {
      const total = totalCount == null ? "?" : totalCount;
      const unique =
        requested == null ? `${returned} unique` : `${returned}/${requested} unique`;
      console.error(
        `  page ${pages}: +${pageSize} from Unipile, ${unique} (search has ${total})`,
      );
    },
  });

  const items = args.includeRaw ? result.items : result.items.map(withoutRaw);
  const envelope = {
    extracted_at: new Date().toISOString(),
    kind: result.kind,
    url,
    requested: result.requested,
    returned: items.length,
    unipile_total_count: result.totalCount,
    pages: result.pages,
    items,
  };

  const outPath =
    args.out ||
    join(config.outputDir, `${result.kind}-${timestamp()}.json`);
  writeJson(outPath, envelope);
  console.error(`Wrote ${items.length} ${result.kind} to ${outPath}`);
  console.log(outPath);
}

async function cmdCompanyProfile(args) {
  const fromPath = args.from;
  const idArg = args.id || args._[0];
  const urlArg = args.url;

  if (!fromPath && !idArg && !urlArg) {
    throw new Error(`Missing --from or --id.\n\n${usage()}`);
  }
  if (fromPath && (idArg || urlArg)) {
    throw new Error(`Use either --from or --id, not both.\n\n${usage()}`);
  }

  const config = getConfig();
  const client = new UnipileClient(config);
  await client.ensureLinkedInAccounts();

  if (fromPath) {
    const envelope = readExtract(fromPath);
    const result = await enrichFromExtract({
      client,
      config,
      envelope,
      includeRaw: Boolean(args.includeRaw),
      onProgress({ index, total, identifier, ok, error }) {
        const label = identifier || "(no id)";
        console.error(
          `  ${index}/${total} ${label}${ok ? "" : `  ! ${error || "failed"}`}`,
        );
      },
    });

    const requested = result.requested;
    const failed = result.failed;
    const returned = requested - failed;

    const out = {
      enriched_at: new Date().toISOString(),
      kind: result.kind,
      source: fromPath,
      url: envelope.url ?? null,
      requested,
      returned,
      failed,
      skipped: result.skipped || 0,
      items: result.items,
    };

    const outPath =
      args.out || join(config.outputDir, `companies-profiles-${timestamp()}.json`);
    writeJson(outPath, out);
    console.error(
      `Wrote ${returned} enriched ${result.kind} to ${outPath}` +
        (failed ? ` (${failed} failed)` : "") +
        (result.skipped ? ` (${result.skipped} skipped)` : ""),
    );
    console.log(outPath);
    return;
  }

  const identifier = parseCompanyIdentifier(idArg || urlArg);
  if (!identifier) {
    throw new Error(`Could not parse a company identifier from ${idArg || urlArg}`);
  }

  try {
    const profile = await fetchOneProfile({
      client,
      config,
      identifier,
      includeRaw: Boolean(args.includeRaw),
    });
    const out = {
      enriched_at: new Date().toISOString(),
      kind: "company_profile",
      source: null,
      identifier,
      requested: 1,
      returned: 1,
      failed: 0,
      skipped: 0,
      items: [profile],
    };
    const outPath =
      args.out || join(config.outputDir, `companies-profiles-${timestamp()}.json`);
    writeJson(outPath, out);
    console.error(`Wrote 1 company profile to ${outPath}`);
    console.log(outPath);
  } catch (err) {
    const out = {
      enriched_at: new Date().toISOString(),
      kind: "company_profile",
      source: null,
      identifier,
      requested: 1,
      returned: 0,
      failed: 1,
      skipped: 0,
      items: [{ profile_error: err.message || String(err), identifier }],
    };
    const outPath =
      args.out || join(config.outputDir, `companies-profiles-${timestamp()}.json`);
    writeJson(outPath, out);
    console.error(`Failed to fetch ${identifier}: ${err.message || err}`);
    console.log(outPath);
    process.exitCode = 1;
  }
}

async function cmdJobs(args) {
  const fromPath = args.from || args._[0];
  if (!fromPath) throw new Error(`Missing --from.\n\n${usage()}`);

  const count = parseCount(args.count);
  const config = getConfig();
  const client = new UnipileClient(config);
  await client.ensureLinkedInAccounts();

  const envelope = readExtract(fromPath);
  const result = await attachJobs({
    client,
    config,
    envelope,
    count,
    includeRaw: Boolean(args.includeRaw),
    region: args.region,
    onProgress({ index, total, companyId, ok, jobCount, error }) {
      console.error(
        `  ${index}/${total} ${companyId}${ok ? `  ${jobCount} jobs` : `  ! ${error || "failed"}`}`,
      );
    },
  });

  const requested = result.requested;
  const failed = result.failed;
  const returned = requested - failed;
  const out = {
    enriched_at: new Date().toISOString(),
    kind: result.kind,
    source: fromPath,
    url: envelope.url ?? null,
    requested,
    returned,
    failed,
    skipped: result.skipped || 0,
    jobs_returned: result.jobs_returned,
    items: result.items,
  };

  const outPath = args.out || join(config.outputDir, `companies-jobs-${timestamp()}.json`);
  writeJson(outPath, out);
  console.error(
    `Wrote ${result.jobs_returned} jobs across ${returned} companies to ${outPath}` +
      (failed ? ` (${failed} failed)` : "") +
      (result.skipped ? ` (${result.skipped} skipped)` : ""),
  );
  console.log(outPath);
}

async function cmdListAccounts() {
  const config = getConfig();
  const client = new UnipileClient(config);
  const accounts = await client.fetchAllAccounts();

  if (!accounts.length) {
    console.error("No accounts returned. Check UNIPILE_API_KEY and UNIPILE_DSN.");
    process.exitCode = 1;
    return;
  }

  console.error("Connected Unipile accounts:\n");
  for (const account of accounts) {
    const id = account.id ?? account.account_id ?? "?";
    const type = account.type ?? account.provider ?? "";
    const name = account.name ?? account.display_name ?? "";
    const status = sourceStatusSummary(account);
    const sn = isLinkedInAccount(account) && hasSalesNavigator(account) ? "  SN" : "";
    console.error(`  ${id}  ${type}  ${name}  [${status}]${sn}`);
  }
  const sn = accounts.filter(
    (account) => isLinkedInAccount(account) && hasSalesNavigator(account),
  ).length;
  console.error(
    `\nExtract (Sales Navigator search) round-robins only the ${sn} seat(s) marked SN.\n` +
      `company-profile and jobs round-robin every connected LinkedIn account.`,
  );
}

async function cmdConnect(args) {
  const config = getConfig();
  const client = new UnipileClient(config);
  const hours = parseHours(args.hours);
  const providers = parseProviders(args.providers);
  const label = args.label ?? args.name;

  // One raw wizard URL, no server and no tunnel. Single use, and Unipile drops
  // every hosted-auth link on its daily restart, so send it right away.
  if (args.direct) {
    const url = await mintConnectUrl(client, { providers, hours, name: label });
    console.error(`\nWhatsApp:\n${whatsappText(url, label)}\n`);
    console.error("This wizard URL is single-use and expires. Send it now.");
    console.log(url);
    return;
  }

  const port = parsePort(args.port, config.connectHookPort);
  const token = args.token ?? config.connectHookToken;

  const hook = await startConnectHook({
    client,
    port,
    token,
    hours,
    providers,
    label,
    notifySecret: randomUUID(),
    onEvent: (message) => console.error(`  ${message}`),
    onConnected: (payload) => {
      const status = String(payload?.status ?? "").toUpperCase();
      const who = payload?.name ? `${payload.name} ` : "";
      if (status === "CREATION_SUCCESS" || status === "RECONNECTED") {
        console.error(`\n  OK  ${who}connected - account_id ${payload?.account_id ?? "?"}`);
      } else {
        console.error(`\n  !!  ${who}callback: ${status || "unknown status"}`);
      }
      try {
        appendConnectionLog(config.connectLogPath, payload);
      } catch (err) {
        console.error(`  (could not write ${config.connectLogPath}: ${err.message})`);
      }
    },
  });
  console.error(`Hook listening on http://0.0.0.0:${port}`);

  let tunnel = null;
  let origin;

  if (args.noTunnel) {
    origin = config.connectHookPublicUrl || `http://localhost:${port}`;
  } else {
    const bin = await resolveCloudflared({ onProgress: (m) => console.error(m) });
    console.error("Opening a cloudflared quick tunnel...");
    try {
      tunnel = await startTunnel({ bin, port });
    } catch (err) {
      await hook.close();
      throw err;
    }
    origin = tunnel.url;
  }

  hook.setOrigin(origin);
  const share = shareUrl({ origin, token });

  const shutdown = async () => {
    console.error("\nStopping. The link above stops working now.");
    tunnel?.stop();
    await hook.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(`\nShare: ${share}`);
  console.error(`\nWhatsApp:\n${whatsappText(share, label)}\n`);
  if (origin.startsWith("http://localhost")) {
    console.error(
      "This is a localhost URL. Nobody outside this machine can open it - " +
        "set CONNECT_HOOK_PUBLIC_URL, or drop --no-tunnel to get a public one.",
    );
  } else {
    console.error(
      "Live only while this process runs, and the hostname changes on restart.\n" +
        "Each visitor gets a freshly minted wizard. Ctrl+C to stop.",
    );
  }
  console.log(share);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "-h" || command === "--help") {
    console.error(usage());
    process.exit(command ? 0 : 1);
  }

  const args = parseArgs(argv.slice(1));
  if (command === "extract") {
    await cmdExtract(args);
  } else if (command === "company-profile") {
    await cmdCompanyProfile(args);
  } else if (command === "jobs") {
    await cmdJobs(args);
  } else if (command === "connect") {
    await cmdConnect(args);
  } else if (command === "connect-link") {
    // Legacy alias: the one-shot raw wizard URL.
    await cmdConnect({ ...args, direct: true });
  } else if (command === "connect-hook") {
    await cmdConnect(args);
  } else if (command === "list-accounts") {
    await cmdListAccounts();
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
