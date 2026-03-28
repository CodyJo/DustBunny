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
| `db show ...` | `bunny db show ...` | No |
| `db delete <id>` | `bunny db delete <id>` | Yes |
| `db regions list ...` | `bunny db regions list ...` | No |
| `db regions add ...` | `bunny db regions add ...` | No |
| `db regions remove ...` | `bunny db regions remove ...` | No |
| `db regions update ...` | `bunny db regions update ...` | No |
| `db usage ...` | `bunny db usage ...` | No |
| `db quickstart ...` | `bunny db quickstart ...` | No |
| `db shell ...` | `bunny db shell ...` | No |
| `db tokens create ...` | `bunny db tokens create ...` | No |
| `db tokens invalidate ...` | `bunny db tokens invalidate ...` | No |
| `db sql <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |
| `db query <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |
| `db exec <id> <sql>` | `bunny db shell <id> --execute <sql> --mode json` | Yes |

## DustBunny-only commands

These are the commands that are new to DustBunny and not part of the documented official Bunny CLI surface.

If a user or coding agent hits a Bunny workflow that is covered by neither the official CLI nor DustBunny, use the opt-in local extension workflow in [docs/SUPPORT-DEVELOPMENT.md](docs/SUPPORT-DEVELOPMENT.md).

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

### DustBunny DB extensions

- `db sql <id> <sql> [jsonArgs]`

## Native DustBunny commands

These commands stay in DustBunny because the official CLI readme does not document an equivalent call, or DustBunny exposes a different command model.

These native paths are also the parts most influenced by reverse engineering during a migration onto Bunny: they were built to fill practical gaps around payload preservation, response normalization, and missing workflow coverage.

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

### Experimental native-only DB extensions

These are disabled by default and documented in [docs/EXPERIMENTAL.md](EXPERIMENTAL.md).

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
- `--experimental`
