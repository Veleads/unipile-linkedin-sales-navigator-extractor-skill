# Unipile lead extractor

Pull people or companies from a LinkedIn Sales Navigator search URL via the Unipile API. Node CLI, no dependencies.

## Setup

```bash
copy .env.example .env
```

Fill in `UNIPILE_API_KEY`, `UNIPILE_DSN`, and `UNIPILE_ACCOUNT_ID`. The DSN looks like `api8.unipile.com:13851` (shown next to the API key). The connected LinkedIn account must have an active Sales Navigator seat.

If you do not know the account id:

```bash
npm run accounts
```

## Extract

```bash
npm run extract -- --url "https://www.linkedin.com/sales/search/people?..." --count 50
npm run extract -- --url "https://www.linkedin.com/sales/search/company?..." --count 50
```

JSON is written to `output/people-<timestamp>.json` or `output/companies-<timestamp>.json`. Pass `--include-raw` to keep Unipile's original item payload.

Each search page waits a random 2.5–6.5s (plus an occasional longer pause) so pagination does not look like a tight loop. Override with `DELAY_MIN_MS` / `DELAY_MAX_MS`.

## Claude Code

`/extract-leads <url> <count>` runs the same CLI.
