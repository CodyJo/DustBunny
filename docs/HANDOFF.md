# DustBunny Handoff

## Current Direction

DustBunny is the public extraction of the Bunny CLI that previously lived inside Back Office. The public repo now includes the full public-safe command surface, including experimental Bunny Database support.

## Completed

- Created standalone CLI package in `bin/dustbunny.mjs`
- Added focused public-safe test coverage in `test/dustbunny.test.mjs`
- Added package metadata, README, license, and local agent instructions
- Restored Bunny Database functionality from the original CLI, while keeping the repo free of local secrets and private Back Office context

## Pending

- If desired, publish to npm after confirming package naming
- Expand test coverage for DNS and Pull Zone mutations with mocked clients

## Architectural Decisions

- Single-file CLI for easy inspection and low setup overhead
- Direct Bunny API calls using `fetch`
- No dependency on Back Office modules, configs, or docs
- Database command surface is included and explicitly documented as experimental because Bunny may change those APIs

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
