# Brainbase runtime hygiene

## Runtime roles

The public Lightsail runtime is Graph/API-only. It does not own the personal
workspace project catalog (`config.yml`). Set:

```ini
Environment=BRAINBASE_PROJECT_CATALOG_MODE=disabled
```

The local Brainbase runtime owns the project catalog and uses the default
`required` mode. A missing or unreadable `config.yml` is therefore an
`unhealthy` config check locally; it must never be reported as a valid empty
catalog.

## Post-deploy verification

Run from the deployed checkout:

```bash
BRAINBASE_EXPECTED_SHA="$(git rev-parse --short HEAD)" \
BRAINBASE_EXPECTED_CATALOG_STATUS=not_applicable \
node scripts/verify-brainbase-runtime-hygiene.mjs
```

Set `BRAINBASE_PHILOSOPHY_SMOKE_URL` to the authenticated Graph context URL when
an auth token is available. The guard verifies health, deployed revision,
catalog applicability and checkout cleanliness. Any mismatch exits non-zero.

## Terminal recovery

The PTY watchdog repairs each session independently. An active record whose
workspace path no longer exists is classified as `workspace_missing`; it is
not restarted every watchdog cycle and cannot prevent later sessions or ttyd
repair from running.

`workspace_missing` is a retirement candidate, not deletion authorization.
Preserve the session record and conversation evidence until the normal archive
finalizer can prove that no dirty or unpushed work remains. Historical archive
documents containing old paths are evidence and must not be rewritten.

## Production-only audit artifacts

One-off scripts created during a production investigation are not runtime
state or repository SSOT. Before removing them from a checkout:

1. prove that no service, process or tracked file references them;
2. record path, SHA-256, provenance and canonical replacement;
3. preserve rollback data separately with restricted permissions;
4. move the scripts to a restricted operations archive before any later
   deletion decision.
