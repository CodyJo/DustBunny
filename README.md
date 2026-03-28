# DustBunny

DustBunny is a public CLI for operating Bunny.net Magic Containers, DNS zones, and Pull Zones.

This repo intentionally excludes private Back Office logic and excludes Bunny Database control-plane features that depended on undocumented or private API surfaces.

## Install

```bash
npm install -g dustbunny
```

Or run it locally:

```bash
node ./bin/dustbunny.mjs help
```

## Authentication

DustBunny checks for credentials in this order:

1. `BUNNY_API_KEY`
2. `~/.config/bunnynet.json` at `profiles.default.api_key`

Example config:

```json
{
  "profiles": {
    "default": {
      "api_key": "your_api_key"
    }
  }
}
```

If neither source is present, the CLI fails before making any API request.

## How the CLI talks to Bunny

DustBunny sends direct HTTPS requests to `https://api.bunny.net` using the `AccessKey` header.

Request behavior:

- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` are sent directly to Bunny API endpoints.
- JSON payloads are serialized automatically.
- Successful JSON responses are parsed and printed.
- Empty successful responses are treated as success.
- Non-JSON error bodies are still shown, so you can see Bunny's raw response.

Error handling:

- Any non-2xx response fails the command immediately.
- Errors include the HTTP status, method, path, and response body.
- Validation failures are caught locally before any network call when possible.

## API guide

### Magic Containers

These commands use `/mc/apps` endpoints.

```bash
dustbunny apps
dustbunny app app_123
dustbunny app spec app_123
dustbunny app create demo acme/demo:v1 registry_123 3000 .env
dustbunny app create-spec ./app-spec.json
dustbunny app image app_123 acme/demo:v2 registry_123
dustbunny app scale app_123 2 5
dustbunny app apply app_123 ./app-spec.json
dustbunny app delete app_123
```

What DustBunny checks:

- Image refs must be `namespace/name:tag`.
- Scale values must be integers with `0 <= min <= max`.
- App commands fail if the target app has no container template to patch.
- `app create-spec` and `app apply` require a valid exported spec shape.

Fallback and preservation logic:

- `app spec` exports a normalized shape from Bunny's app response so you can round-trip it back through `app apply`.
- `app apply` matches templates by `id`, then by `name`, then by position. That keeps updates stable even if Bunny returns templates in a slightly different shape.
- Template patching preserves fields like `packageId`, `imageRegistryId`, `entryPoint`, and `volumeMounts` when Bunny already has them.
- Endpoint payloads are normalized before patching so existing CDN or anycast endpoints survive updates in a consistent format.

### Environment variables

These commands patch the first container template on the app.

```bash
dustbunny env sync app_123 .env.production
dustbunny env merge app_123 .env.shared
dustbunny env unset app_123 OLD_KEY
```

Input support:

- `.env` format
- `.json` object format

What DustBunny checks:

- Blank lines and comments are ignored in `.env` files.
- Quoted values are unwrapped.
- Invalid `KEY=value` lines fail fast.

Fallback and preservation logic:

- `env sync` replaces the app's environment variable set with the file contents.
- `env merge` merges file values on top of current Bunny values.
- Duplicate keys are deduplicated and sorted by variable name for stable patch payloads.
- `env unset` removes one key but preserves the rest of the template.

### Endpoints

These commands work against a Magic Container app's template endpoints.

```bash
dustbunny endpoint list app_123
dustbunny endpoint cdn app_123 3001 admin-cdn
dustbunny endpoint remove app_123 admin-cdn
```

What DustBunny checks:

- Only supported endpoint types are normalized: `cdn` and `anycast`.
- Removing an endpoint fails if no endpoint matches the given name or host.

Fallback and preservation logic:

- Existing endpoints are normalized before updates so Bunny gets a clean payload shape.
- `endpoint remove` can match by display name, public host, or public URL.
- CDN settings like port mappings, sticky sessions, and linked Pull Zone IDs are preserved when present.

### DNS

These commands use Bunny DNS zone endpoints.

```bash
dustbunny dns zones
dustbunny dns zone 123456
dustbunny dns records 123456
dustbunny dns set 123456 www CNAME app.example.com 300
dustbunny dns pullzone 123456 cdn 7890 60
dustbunny dns delete 123456 555
```

What DustBunny checks:

- `dns set` requires `zoneId`, `name`, `type`, and `value`.
- Record types accept friendly names like `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `REDIRECT`, `FLATTEN`, and `PULLZONE`.
- Numeric record type codes also work.

Fallback and preservation logic:

- `dns records` and `dns zones` accept Bunny responses whether fields are capitalized or lowercase.
- `dns set` first fetches existing records and updates the matching name/type pair if one already exists.
- If no record exists, it creates a new one.
- `dns pullzone` is a thin wrapper over `dns set` using Bunny's Pull Zone record type with `AutoSslIssuance: true`.

### Pull Zones

These commands use Bunny Pull Zone endpoints.

```bash
dustbunny pz list
dustbunny pz create site-origin https://origin.example.com
dustbunny pz origin 7890 https://new-origin.example.com
dustbunny pz hostname 7890 cdn.example.com
dustbunny pz ssl 7890 cdn.example.com
dustbunny pz purge 7890
```

Fallback and preservation logic:

- `pz list` tolerates Bunny responses with either uppercase or lowercase field names.
- `pz ssl` does two calls in sequence: request Bunny's free certificate load, then force SSL on that hostname.
- `pz purge` sends the purge request directly and treats an empty success response as valid.

### Health and deploy verification

```bash
dustbunny health https://example.com/health
dustbunny wait app_123 300 10
```

What DustBunny checks:

- `health` accepts either a full URL or a bare host, and prefixes `https://` when needed.
- `wait` polls the app state until timeout.

Fallback and verification logic:

- `wait` reads app status from Bunny and separately probes `https://<displayEndpoint>/health` when Bunny provides a public endpoint.
- If Bunny has not assigned an endpoint yet, `wait` still tracks status and instance count.
- A healthy state requires app status `running` or `active`, plus a health check below HTTP 400 when an endpoint exists.
- If the health probe fails temporarily, DustBunny keeps polling until timeout instead of failing on the first miss.

## Why this helps when you add new Bunny config

If you change app settings directly in Bunny and then use DustBunny again, the CLI tries to avoid stomping on unrelated settings.

Examples:

- App template patches preserve existing template fields that DustBunny is not actively changing.
- Endpoint normalization preserves known endpoint configuration rather than rebuilding everything from scratch.
- DNS updates modify an existing record when name and type match, instead of blindly creating duplicates.
- Spec export and apply are designed as a round-trip workflow so you can inspect what Bunny currently has, edit it, and push it back with fewer surprises.

## Command summary

```bash
dustbunny apps
dustbunny app <id>
dustbunny app create <name> <namespace/name:tag> [registryId] [port] [envFile]
dustbunny app create-spec <spec.json>
dustbunny app delete <id>
dustbunny app spec <id>
dustbunny app image <id> <namespace/name:tag> [registryId]
dustbunny app scale <id> <min> <max>
dustbunny app apply <id> <spec.json>
dustbunny env sync <id> <file>
dustbunny env merge <id> <file>
dustbunny env unset <id> <key>
dustbunny endpoint list <id>
dustbunny endpoint cdn <id> [port] [name]
dustbunny endpoint remove <id> <nameOrHost>
dustbunny dns zones
dustbunny dns zone <zoneId>
dustbunny dns records <zoneId>
dustbunny dns set <zoneId> <name> <type> <value> [ttl]
dustbunny dns pullzone <zoneId> <name> <pullZoneId> [ttl]
dustbunny dns delete <zoneId> <recordId>
dustbunny pz list
dustbunny pz create <name> <originUrl>
dustbunny pz origin <pullZoneId> <originUrl>
dustbunny pz hostname <pullZoneId> <hostname>
dustbunny pz ssl <pullZoneId> <hostname>
dustbunny pz purge <pullZoneId>
dustbunny wait <id> [timeoutSec] [intervalSec]
dustbunny health <url>
```

## Development

```bash
npm test
```

## Notes

- This project is not affiliated with or endorsed by Bunny.net.
- Review commands before running them against production resources.
