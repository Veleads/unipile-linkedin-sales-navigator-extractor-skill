---
description: Fetch classic LinkedIn job postings for companies from extract or profile JSON via Unipile
argument-hint: <extract-or-profiles.json> [count]
---

Fetch classic LinkedIn job postings via Unipile for **$ARGUMENTS**.

Parse `$ARGUMENTS` as `<path> [count]`. Path is JSON written by `/extract-leads` or `/get-company-profile`. Count is optional and caps jobs **per company**.

Use this after either previous skill that produced companies (or people with `company_id`).

## Run

From the project root:

If a per-company count was given:

```bash
npm run jobs -- --from "<path>" --count <count>
```

If no count was given, omit `--count` so each company's classic job search paginates until Unipile has no next cursor:

```bash
npm run jobs -- --from "<path>"
```

Do not call Unipile with curl. Do not skip or shorten the CLI's human-like delays.

The CLI loads connected LinkedIn accounts from Unipile and round-robins them. Do not ask for an account id.

Classic job search uses numeric company ids. Items with only a slug and no numeric id are skipped.

## After it finishes

- Print the output JSON path the CLI wrote
- Print `returned` vs `requested` vs `failed` vs `jobs_returned` (`skipped` is items with no numeric company id)
- A company with zero open jobs is a successful search, not a failure
- If some companies failed, say how many and do not treat a partial run as a total failure unless `returned` is 0
- Do not dump the full JSON into chat unless asked
