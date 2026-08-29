---
description: Enrich extract JSON (or a single company) with LinkedIn company profiles via Unipile
argument-hint: <extract.json|company-id-or-slug>
---

Retrieve LinkedIn company profiles via Unipile for **$ARGUMENTS**.

Parse `$ARGUMENTS` as either:

- A path to extract JSON written by `/extract-leads` (typical), or
- A company id, public slug, or LinkedIn/Sales Navigator company URL

## Run

From the project root:

If the argument is an extract JSON file:

```bash
npm run company-profile -- --from "<path>"
```

If the argument is a company id or slug:

```bash
npm run company-profile -- --id "<id-or-slug>"
```

Do not call Unipile with curl. Do not skip or shorten the CLI's human-like delays.

The CLI loads connected LinkedIn accounts from Unipile and round-robins them. Do not ask for an account id.

Use this after `/extract-leads` so companies (or people with `company_id`) get website, location, headcount, and extra firmographic fields in a new JSON file.

## After it finishes

- Print the output JSON path the CLI wrote
- Print `returned` vs `requested` vs `failed` (`skipped` is people with no `company_id`)
- If some profiles failed, say how many and do not treat a partial run as a total failure unless `returned` is 0
- Do not dump the full JSON into chat unless asked
