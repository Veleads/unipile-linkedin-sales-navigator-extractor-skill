# Unipile lead extractor

Pull people or companies from a LinkedIn Sales Navigator search URL via the Unipile API, then optionally enrich companies with full LinkedIn profiles and classic job postings. Node CLI, no dependencies.

LinkedIn accounts are discovered from Unipile at runtime. Search, profile, and job calls round-robin across connected seats so you do not set an account id.

## Setup

```bash
copy .env.example .env
```

Fill in `UNIPILE_API_KEY` and `UNIPILE_DSN`. The DSN looks like `api8.unipile.com:13851` (shown next to the API key). At least one connected LinkedIn account must have an active Sales Navigator seat for search.

To see which accounts Unipile will rotate:

```bash
npm run accounts
```

## Extract

```bash
npm run extract -- --url "https://www.linkedin.com/sales/search/people?..." --count 50
npm run extract -- --url "https://www.linkedin.com/sales/search/company?..." --count 50
```

Omit `--count` to paginate until Unipile has no next cursor (everything LinkedIn returns for that query):

```bash
npm run extract -- --url "https://www.linkedin.com/sales/search/people?..."
```

LinkedIn still caps a single Sales Navigator search at about **2,500 people** or **1,000 companies**, even if Unipile's `unipile_total_count` is higher. JSON is written to `output/people-<timestamp>.json` or `output/companies-<timestamp>.json`. Pass `--include-raw` to keep Unipile's original item payload.

Each search page waits a random 2.5–6.5s (plus an occasional longer pause) so pagination does not look like a tight loop. Override with `DELAY_MIN_MS` / `DELAY_MAX_MS`.

## Company profiles

After a company (or people) extract, fetch full LinkedIn company profiles and merge them into a new JSON file:

```bash
npm run company-profile -- --from output/companies-<timestamp>.json
npm run company-profile -- --id 7944994
npm run company-profile -- --id unipile
```

People extracts attach `company_profile` on each person that has a `company_id`. Companies get website, location, headcount, and extra firmographic fields filled in. Output is `output/companies-profiles-<timestamp>.json`.

## Job postings

After extract or company-profile, fetch classic LinkedIn jobs for each company id:

```bash
npm run jobs -- --from output/companies-<timestamp>.json
npm run jobs -- --from output/companies-profiles-<timestamp>.json
```

One classic job search per company, paginated until Unipile has no next cursor. Pass `--count N` to cap jobs per company. Jobs are attached as `jobs` on company items (or `company_profile.jobs` on people). Output is `output/companies-jobs-<timestamp>.json`.

## Claude Code

`/extract-leads <url> [count]` runs the extract CLI. Omit count to fetch every page Unipile returns.

`/get-company-profile <extract.json|id>` enriches that extract (or looks up one company).

`/get-job-postings <extract-or-profiles.json>` attaches classic LinkedIn job postings for each company.
