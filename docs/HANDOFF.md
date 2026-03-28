# DustBunny Handoff

## Current Direction

DustBunny is the public extraction of the Bunny CLI that previously lived inside Back Office. The public repo now includes the full public-safe command surface, including experimental Bunny Database support.

## Completed

- Created standalone CLI package in `bin/dustbunny.mjs`
- Added focused public-safe test coverage in `test/dustbunny.test.mjs`
- Added package metadata, README, license, and local agent instructions
- Restored Bunny Database functionality from the original CLI, while keeping the repo free of local secrets and private Back Office context
- Added official Bunny CLI passthrough for documented supported commands
- Added `docs/API-MAPPING.md` to explain official passthrough versus DustBunny-native routing

## Pending

- If desired, publish to npm after confirming package naming
- Expand test coverage for DNS and Pull Zone mutations with mocked clients

## Architectural Decisions

- Runtime code is now split under `src/` with a thin `bin/` entrypoint
- Direct Bunny API calls using `fetch`
- No dependency on Back Office modules, configs, or docs
- Database command surface is included and explicitly documented as experimental because Bunny may change those APIs
- Official Bunny CLI is preferred for selected documented commands via `npx -y @bunny.net/cli@latest`
- DustBunny maps `BUNNY_API_KEY` to `BUNNYNET_API_KEY` for official passthrough
- Official passthrough falls back to DustBunny's native implementation only when the command has a compatible local path
- Official passthrough can prefer a configured binary, a local `bunny` binary, or `npx`, in that order
- Routing flags now exist: `--prefer-official`, `--prefer-native`, `--no-fallback`

## Read First

- `README.md`
- `docs/API-MAPPING.md`
- `src/config.mjs`
- `src/official-cli.mjs`
- `bin/dustbunny.mjs`
- `src/cli.mjs`
- `test/dustbunny.test.mjs`

## Integration Points

- Bunny API via `https://api.bunny.net`
- Local config via `~/.config/bunnynet.json`
- Environment variable `BUNNY_API_KEY`

## Recommended Next Steps

- Add mocked tests for `dns set`, `dns delete`, and `pz ssl`
- Consider splitting the CLI into smaller modules if the command surface grows
