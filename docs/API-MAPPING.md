# DustBunny API Mapping

This file explains whether a command:

- delegates to the official Bunny CLI first
- runs directly in DustBunny
- falls back to DustBunny if the official CLI path fails

## Official-first commands

These commands are translated to `npx -y @bunny.net/cli@latest ...`.

| DustBunny command | Official CLI call | Fallback |
| --- | --- | --- |
| `login` | `bunny login` | No |
| `logout` | `bunny logout` | No |
| `whoami` | `bunny whoami` | No |
| `config ...` | `bunny config ...` | No |
| `registries ...` | `bunny registries ...` | No |
| `scripts ...` | `bunny scripts ...` | No |
| `db list` | `bunny db list` | Yes |
| `db create <name> [primary] [storage] [replicas]` | `bunny db create --name ... [--primary ...] [--storage-region ...] [--replicas ...]` | Yes |
| `db delete <id>` | `bunny db delete <id>` | Yes |
| `db sql <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |
| `db query <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |
| `db exec <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |

## Native DustBunny commands

These commands stay in DustBunny because the official CLI readme does not document an equivalent call, or DustBunny exposes a different command model.

### Apps

- `apps`
- `app <id>`
- `app create`
- `app create-spec`
- `app delete`
- `app spec`
- `app image`
- `app scale`
- `app apply`
- `wait`

### Env / Endpoints / DNS / Pull Zones / Health

- `env sync`
- `env merge`
- `env unset`
- `endpoint list`
- `endpoint cdn`
- `endpoint remove`
- `dns zones`
- `dns zone`
- `dns records`
- `dns set`
- `dns pullzone`
- `dns delete`
- `pz list`
- `pz create`
- `pz origin`
- `pz hostname`
- `pz ssl`
- `pz purge`
- `health`

### Native-only DB extensions

- `db limits`
- `db api status`
- `db api sync-spec`
- `db group`
- `db group-token`
- `db mirror`
- `db spec`
- `db regions set`
- `db replica add`
- `db replica remove`
- `db versions`
- `db fork`
- `db restore`
- `db batch`
- `db tables`
- `db schema`
- `db indexes`
- `db pragma`
- `db integrity-check`
- `db fk-check`
- `db dump schema`
- `db doctor`
- `db usage <id> <from> <to>`
- `db stats <id> <from> <to>`
- `db group-stats <id> <from> <to>`
- `db active-usage`

## Auth bridging

When DustBunny calls the official Bunny CLI, it maps:

- `BUNNY_API_KEY` -> `BUNNYNET_API_KEY`

This lets a DustBunny user keep using the existing auth setup while still benefiting from the official CLI where possible.

## Official CLI resolution

When DustBunny needs the official CLI, it resolves it in this order:

1. `DUSTBUNNY_OFFICIAL_CLI_BIN`
2. local `bunny` on `PATH`
3. `npx -y @bunny.net/cli@<version>`

Version source:

- `DUSTBUNNY_OFFICIAL_CLI_VERSION`
- otherwise `latest`

## Routing flags

- `--prefer-official`
- `--prefer-native`
- `--no-fallback`
