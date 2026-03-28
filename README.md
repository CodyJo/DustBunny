# DustBunny

DustBunny is a public CLI for Bunny.net Magic Containers, DNS zones, Pull Zones, and experimental Bunny Database operations.

This repo is derived from the private Back Office CLI, but it does not include your private config, credentials, customer data, or project-specific operational context.

## Install

```bash
npm install -g dustbunny
```

Or run it locally:

```bash
node ./bin/dustbunny.mjs help
```

## Authentication

DustBunny resolves credentials in this order:

1. `BUNNY_API_KEY`
2. `~/.config/bunnynet.json` at `profiles.default.api_key`

Database commands can also use:

- `BUNNY_DB_ACCESS_KEY`
- `BUNNY_DB_BEARER_TOKEN`
- `BUNNY_DB_SPEC_CACHE`

If the DB-specific access key is not set, DustBunny falls back to the main Bunny API key for database control-plane requests.

Example config:

```json
{
  "profiles": {
    "default": {
      "api_key": "your_api_key",
      "db_access_key": "optional_database_access_key",
      "db_bearer_token": "optional_database_bearer_token",
      "db_spec_cache": "/your/cache/path.json"
    }
  }
}
```

## How the CLI talks to Bunny

DustBunny makes direct HTTPS calls to:

- `https://api.bunny.net`
- `https://api.bunny.net/database`

Request behavior:

- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` are sent directly to Bunny.
- JSON payloads are serialized automatically.
- JSON responses are parsed automatically.
- Empty success responses are treated as valid success.
- Error bodies are shown even when Bunny does not return JSON.

Validation behavior:

- Missing required arguments fail before a request is sent.
- Image references are validated as `namespace/name:tag`.
- Scale and TTL values are normalized to numbers where the API expects numbers.
- Database date ranges are validated and converted to ISO timestamps.

## Fallback logic

DustBunny includes deliberate fallback behavior so it is safer to use against changing Bunny responses.

### Config fallback

- Main auth uses `BUNNY_API_KEY` first, then Bunny config file fallback.
- Database control-plane auth uses `BUNNY_DB_ACCESS_KEY`, then `db_access_key` from config, then falls back to the main Bunny API key.
- Database SQL execution uses `BUNNY_DB_BEARER_TOKEN`, then `db_bearer_token` from config.

### Response-shape fallback

- DNS and Pull Zone listing tolerate Bunny responses using either uppercase or lowercase field names.
- App spec import/export supports both `containerTemplate` and `containerTemplates`.
- App template matching during `app apply` falls back from template `id`, to template `name`, to array position.

### State-preservation fallback

- App patch operations preserve existing `packageId`, `imageRegistryId`, `entryPoint`, and `volumeMounts` when present.
- Endpoint patching preserves supported endpoint data instead of rebuilding every field from scratch.
- `env merge` merges on top of the current Bunny state instead of replacing it.
- `dns set` updates an existing record with the same name and type before creating a new one.

### Verification fallback

- `wait` keeps polling if Bunny has not assigned an endpoint yet.
- `wait` also keeps polling if the health endpoint is temporarily unavailable.
- A running app is only treated as ready when Bunny reports a healthy status and the health endpoint is acceptable when one exists.

### Database API drift fallback

- Experimental DB control-plane failures trigger a best-effort refresh of Bunny's private DB OpenAPI spec.
- DustBunny compares the cached spec with the latest available spec and reports possible API drift.
- If the spec refresh fails, DustBunny still surfaces the original API failure and tells you the refresh failed too.

## User guide

### Magic Containers

```bash
dustbunny apps
dustbunny app app_123
dustbunny app spec app_123
dustbunny app create demo acme/demo:v1 registry_123 3000 .env
dustbunny app create-spec ./app-spec.json
dustbunny app image app_123 acme/demo:v2 registry_123
dustbunny app scale app_123 2 5
dustbunny app apply app_123 ./app-spec.json
dustbunny wait app_123 300 10
```

API notes:

- App commands use `/mc/apps`.
- `app spec` exports a normalized shape suitable for `app apply` or `app create-spec`.
- `wait` checks Bunny app status and then probes `https://<displayEndpoint>/health` when an endpoint exists.

### Environment variables

```bash
dustbunny env sync app_123 .env.production
dustbunny env merge app_123 .env.shared
dustbunny env unset app_123 OLD_KEY
```

API notes:

- `.env` and `.json` inputs are supported.
- Duplicate env vars are deduplicated and sorted for stable updates.
- `env sync` replaces the set.
- `env merge` overlays on top of current Bunny values.

### Endpoints

```bash
dustbunny endpoint list app_123
dustbunny endpoint cdn app_123 3001 admin-cdn
dustbunny endpoint remove app_123 admin-cdn
```

API notes:

- Supported endpoint normalization currently covers `cdn` and `anycast`.
- Endpoint removal can match by display name, public host, or public URL.

### DNS

```bash
dustbunny dns zones
dustbunny dns zone 123456
dustbunny dns records 123456
dustbunny dns set 123456 www CNAME app.example.com 300
dustbunny dns pullzone 123456 cdn 7890 60
dustbunny dns delete 123456 555
```

API notes:

- `dns set` first fetches the zone and its records.
- If a matching name/type record exists, DustBunny updates it.
- If not, DustBunny creates it.
- `dns pullzone` is a wrapper for Bunny's Pull Zone DNS record type.

### Pull Zones

```bash
dustbunny pz list
dustbunny pz create site-origin https://origin.example.com
dustbunny pz origin 7890 https://new-origin.example.com
dustbunny pz hostname 7890 cdn.example.com
dustbunny pz ssl 7890 cdn.example.com
dustbunny pz purge 7890
```

API notes:

- `pz ssl` first requests Bunny's free certificate load, then enables forced SSL.
- `pz purge` accepts an empty success response as valid.

### Health

```bash
dustbunny health https://example.com/health
```

API notes:

- Bare hosts are converted to `https://...`.
- The command prints status and a short body preview.

### Experimental Bunny Database support

```bash
dustbunny db list
dustbunny db limits
dustbunny db api status
dustbunny db api sync-spec
dustbunny db create demo-db de de uk
dustbunny db token demo-db full-access
dustbunny db group-token demo-db read-only
dustbunny db group demo-db
dustbunny db spec demo-db
dustbunny db regions set demo-db de de uk,us
dustbunny db replica add demo-db us
dustbunny db replica remove demo-db uk
dustbunny db versions demo-db 20
dustbunny db fork demo-db demo-db-copy
dustbunny db restore demo-db version_123
dustbunny db usage demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny db stats demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny db group-stats demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny db active-usage
dustbunny db sql demo-db "select * from users limit 5"
dustbunny db tables demo-db
dustbunny db schema demo-db
dustbunny db indexes demo-db
dustbunny db pragma demo-db journal_mode
dustbunny db integrity-check demo-db
dustbunny db fk-check demo-db
dustbunny db dump schema demo-db
dustbunny db doctor demo-db
```

API notes:

- DB control-plane commands use Bunny database endpoints and are intentionally labeled experimental.
- Some of these APIs are undocumented or preview surfaces and may drift.
- SQL and batch commands require a DB bearer token because they call the pipeline endpoint directly.
- Database identifiers can resolve by database id, name, group id, URL, or derived group id.
- `db doctor` runs several SQL checks and composes a JSON report.

## Privacy and public-safety

This public repo does not ship:

- your personal Bunny keys
- your local config file
- customer or app secrets
- project-specific environment values
- Back Office deployment or portfolio context

It does include the experimental DB logic from the original CLI, because you asked for the full feature set to be public.

## Development

```bash
npm test
```

## Notes

- This project is not affiliated with or endorsed by Bunny.net.
- Review commands before using them in production.
