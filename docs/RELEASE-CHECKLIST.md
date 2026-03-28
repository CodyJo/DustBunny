# Release Checklist

Use this before publishing a new DustBunny release.

## 1. Check upstream Bunny CLI/docs

Run:

```bash
node ./scripts/check-official-cli.mjs
```

This checks the latest published `@bunny.net/cli` package on npm and verifies that the documented official command surface in `docs/API-MAPPING.md` still covers the expected official Bunny CLI commands.

If it fails:

- review the current `@bunny.net/cli` readme
- update `src/official-cli.mjs`
- update `docs/API-MAPPING.md`
- update `README.md`

## 2. Verify DustBunny tests

Run:

```bash
npm test
```

## 3. Verify routing assumptions

Check:

- official passthrough commands still route correctly
- DustBunny-only commands are still clearly labeled as native-only
- `--prefer-official`, `--prefer-native`, and `--no-fallback` behavior still matches docs
- official CLI resolution order still matches docs
- hidden experimental commands still require `--experimental` or `DUSTBUNNY_ENABLE_EXPERIMENTAL=1`

## 4. Verify dependencies and runtime assumptions

Confirm the documentation still accurately says that DustBunny depends on:

- Node.js with built-in `fetch`
- Bunny API credentials
- official Bunny CLI access through one of:
  - `DUSTBUNNY_OFFICIAL_CLI_BIN`
  - local `bunny` binary
  - `npx -y @bunny.net/cli@<version>`

## 5. Review release notes

Call out:

- official CLI parity changes
- new DustBunny-only commands or behaviors
- changes to experimental DB support
- changes in fallback behavior
