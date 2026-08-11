# Runtime artifact retirement ledger

| Date | Runtime | Artifact | Classification | Canonical replacement | Disposition |
|---|---|---|---|---|---|
| 2026-07-24 | Lightsail `/home/ubuntu/brainbase` | `audit-current-vibepro-decision.mjs`, `audit-graph-data.mjs`, `audit-graph-history.mjs`, `audit-person-refs.mjs` | One-off read-only Graph investigation scripts; outputs may contain internal identity, authorization and audit data | `docs/management/evidence/graph-data-ssot-normalization-20260718.json` and the associated Story | Move to restricted operations archive with original path and SHA-256 manifest; do not promote to repository tooling |
| 2026-07-24 | Lightsail `/home/ubuntu/brainbase` | `normalize-graph-data-ssot.mjs` | Exact copy of tracked script at commit `5e0df72cc`; superseded safety contract | `scripts/normalize-graph-data-ssot.mjs` at current HEAD | Move to restricted operations archive; obsolete executable |
| 2026-07-24 | Lightsail `/home/ubuntu/brainbase` | `scripts/.tmp-normalize-graph-data-ssot-current.mjs` | Exact copy of tracked script at commit `9bda9d574`; superseded safety contract | `scripts/normalize-graph-data-ssot.mjs` at current HEAD | Move to restricted operations archive; obsolete executable |

Rollback backup JSON files are outside this retirement scope. In particular,
the Graph normalization rollback point
`2026-07-18T152024997Z.json` remains protected and must not be removed.
