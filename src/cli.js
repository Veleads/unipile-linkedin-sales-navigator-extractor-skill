#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfig } from "./config.js";
import { extract } from "./extract.js";
import { UnipileClient } from "./unipile.js";

function usage() {
  return `Usage:
  node src/cli.js extract --url <sales-navigator-url> --count <n> [--out <path>] [--include-raw]
  node src/cli.js extract <sales-navigator-url> <count>
  node src/cli.js list-accounts

People:    https://www.linkedin.com/sales/search/people?...
Companies: https://www.linkedin.com/sales/search/company?...`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--include-raw") {
      args.includeRaw = true;
    } else if (token === "--url" || token === "--count" || token === "--out") {
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

function withoutRaw(item) {
  const { _raw, ...rest } = item;
  return rest;
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

async function cmdExtract(args) {
  const url = args.url || args._[0];
  const countRaw = args.count ?? args._[1];
  const count = Number(countRaw);

  if (!url) throw new Error(`Missing --url.\n\n${usage()}`);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--count must be a positive integer, got ${countRaw}\n\n${usage()}`);
  }

  const config = getConfig();
  const client = new UnipileClient(config);
  const result = await extract({
    client,
    config,
    url,
    count,
    onProgress({ pages, returned, requested, totalCount, pageSize }) {
      const total = totalCount == null ? "?" : totalCount;
      console.error(
        `  page ${pages}: +${pageSize} from Unipile, ${returned}/${requested} unique (search has ${total})`,
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

async function cmdListAccounts() {
  const config = getConfig({ requireAccount: false });
  const client = new UnipileClient(config);
  const data = await client.listAccounts();
  const accounts = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data)
      ? data
      : [];

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
    const current = id === config.accountId ? "  ← UNIPILE_ACCOUNT_ID" : "";
    console.error(`  ${id}  ${type}  ${name}${current}`);
  }
  console.error(
    `\nSet UNIPILE_ACCOUNT_ID in .env to the LinkedIn account that has Sales Navigator.`,
  );
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
