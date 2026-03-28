# DustBunny

DustBunny is a small CLI for operating Bunny.net Magic Containers, DNS zones, and Pull Zones.

This repository intentionally excludes any private Back Office logic and any Bunny Database control-plane code that depended on undocumented or private API surfaces.

## What it does

- List and inspect Magic Container apps
- Create apps from an image ref or exported JSON spec
- Update app images, autoscaling, endpoints, and environment variables
- Wait for an app to become healthy
- Manage DNS zones and records
- Manage Pull Zones and SSL
- Run a quick HTTP health check

## Install

```bash
npm install -g dustbunny
```

Or run it locally from the repo:

```bash
node ./bin/dustbunny.mjs help
```

## Auth

Set `BUNNY_API_KEY`:

```bash
export BUNNY_API_KEY=your_api_key
```

Or configure Bunny's standard config file:

```json
{
  "profiles": {
    "default": {
      "api_key": "your_api_key"
    }
  }
}
```

Saved at `~/.config/bunnynet.json`.

## Examples

```bash
dustbunny apps
dustbunny app app_123
dustbunny app create demo acme/demo:v1 registry_123 3000 .env
dustbunny env sync app_123 .env.production
dustbunny endpoint cdn app_123 3001 admin-cdn
dustbunny dns zones
dustbunny dns set 123456 www CNAME app.example.com 300
dustbunny pz create site-origin https://origin.example.com
dustbunny health https://example.com/health
```

## Notes

- `dustbunny app spec <id>` exports a reusable JSON shape for `app apply` or `app create-spec`.
- The CLI makes direct Bunny API calls; review commands before using them against production resources.
- This project is not affiliated with or endorsed by Bunny.net.

## Development

```bash
npm test
```
