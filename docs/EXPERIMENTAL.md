# Experimental Commands

These commands are present in the codebase but disabled by default.

Enable them with either:

```bash
dustbunny --experimental ...
```

or:

```bash
export DUSTBUNNY_ENABLE_EXPERIMENTAL=1
```

These commands are intentionally kept out of the main README because they rely on undocumented, preview, or operator-specific behavior and should be treated as unstable.

## Experimental DB/Admin Commands

```bash
dustbunny --experimental db limits
dustbunny --experimental db api status
dustbunny --experimental db api sync-spec
dustbunny --experimental db token demo-db read-only
dustbunny --experimental db group-token demo-db read-only
dustbunny --experimental db group demo-db
dustbunny --experimental db mirror source-db target-db
dustbunny --experimental db spec demo-db
dustbunny --experimental db regions set demo-db de de uk,us
dustbunny --experimental db replica add demo-db us
dustbunny --experimental db replica remove demo-db uk
dustbunny --experimental db versions demo-db 20
dustbunny --experimental db fork demo-db demo-db-copy
dustbunny --experimental db restore demo-db version_123
dustbunny --experimental db query demo-db "select * from users limit 5"
dustbunny --experimental db exec demo-db "pragma foreign_keys"
dustbunny --experimental db batch demo-db ./requests.json
dustbunny --experimental db tables demo-db
dustbunny --experimental db schema demo-db
dustbunny --experimental db indexes demo-db
dustbunny --experimental db pragma demo-db journal_mode
dustbunny --experimental db integrity-check demo-db
dustbunny --experimental db fk-check demo-db
dustbunny --experimental db dump schema demo-db
dustbunny --experimental db doctor demo-db
dustbunny --experimental db usage demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny --experimental db stats demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny --experimental db group-stats demo-db 2026-03-01T00:00:00Z 2026-03-28T00:00:00Z
dustbunny --experimental db active-usage
```

## Notes

- These commands may depend on undocumented or preview Bunny behavior.
- Failure diagnostics may include DB spec drift checks.
- Command shapes and availability may change or be removed.
