---
description: Extract people or companies from a Sales Navigator search URL via Unipile
argument-hint: <sales-navigator-url> <count>
---

Extract **$ARGUMENTS** from Sales Navigator via Unipile.

Parse `$ARGUMENTS` as `<url> <count>`. The URL is either a people or company search; the CLI infers which.

## Run

From the project root:

```bash
npm run extract -- --url "<url>" --count <count>
```

Do not call Unipile with curl. Do not skip or shorten the CLI's human-like delays.

If `.env` is missing `UNIPILE_ACCOUNT_ID`, run `npm run accounts` first, put the LinkedIn account id in `.env`, then extract.

## After it finishes

- Print the output JSON path the CLI wrote
- Print `returned` vs `requested` vs `unipile_total_count`
- If it stopped short of `--count`, say whether the search ran out of pages or Unipile errored
- Do not dump the full lead list into chat unless asked
