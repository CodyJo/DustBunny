# DustBunny Handoff

## Current Direction

DustBunny is the public extraction of the Bunny CLI that previously lived inside Back Office. The public repo is intentionally limited to Magic Containers, DNS, Pull Zones, and health checks.

## Completed

- Created standalone CLI package in `bin/dustbunny.mjs`
- Added focused public-safe test coverage in `test/dustbunny.test.mjs`
- Added package metadata, README, license, and local agent instructions
- Excluded Bunny Database control-plane functionality because it depended on undocumented or private API surfaces

## Pending

- If desired, publish to npm after confirming package naming
- Expand test coverage for DNS and Pull Zone mutations with mocked clients

## Architectural Decisions

- Single-file CLI for easy inspection and low setup overhead
- Direct Bunny API calls using `fetch`
- No dependency on Back Office modules, configs, or docs
- No database command surface in the public repo

## Read First

- `README.md`
- `bin/dustbunny.mjs`
- `test/dustbunny.test.mjs`

## Integration Points

- Bunny API via `https://api.bunny.net`
- Local config via `~/.config/bunnynet.json`
- Environment variable `BUNNY_API_KEY`

## Recommended Next Steps

- Add mocked tests for `dns set`, `dns delete`, and `pz ssl`
- Consider splitting the CLI into smaller modules if the command surface grows
