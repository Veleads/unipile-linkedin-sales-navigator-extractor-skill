---
description: Extract people or companies from a Sales Navigator search URL via Unipile
argument-hint: <sales-navigator-url> [count]
---

Extract **$ARGUMENTS** from Sales Navigator via Unipile.

Parse `$ARGUMENTS` as `<url> [count]`. Count is optional. The URL is either a people or company search; the CLI infers which.

## Run

From the project root:

If a count was given:

```bash
npm run extract -- --url "<url>" --count <count>
```

If no count was given, omit `--count` so the CLI paginates until Unipile has no next cursor:

```bash
npm run extract -- --url "<url>"
```

Do not call Unipile with curl. Do not skip or shorten the CLI's human-like delays.

If `.env` is missing `UNIPILE_ACCOUNT_ID`, run `npm run accounts` first, put the LinkedIn account id in `.env`, then extract.

## After it finishes

- Print the output JSON path the CLI wrote
- Print `returned` vs `requested` vs `unipile_total_count` (`requested` is `null` when fetching all pages)
- If a `--count` was given and it stopped short, say whether the search ran out of pages or Unipile errored
- LinkedIn caps a single Sales Navigator search at about 2,500 people or 1,000 companies even if `unipile_total_count` is higher; that is expected, not an error
- Do not dump the full lead list into chat unless asked
