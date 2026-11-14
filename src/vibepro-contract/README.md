# VibePro producer contract modules

These source-only ESM modules implement the managed-handoff v2 producer, its
adopted-source issuer, and OutcomeCaseService. They have no third-party runtime
dependencies and can be imported directly from a checkout. They are not wired
into the OSS personal runtime or exported by the npm package.

The issuer expects an authenticated actor and trusted construction-time loaders.
It does not authenticate tokens. Callers must enforce repository tenant isolation;
these modules do not provide a database, HTTP endpoint, tenant provisioning, or
production readback. HMAC keys must be supplied by the caller, never committed.

The local canonical identity helper preserves rejection of missing/conflicting
claims and explicit trusted organization-to-tenant bindings. Authentication code
must attach bindings only after resolving the exact pair from a trusted source.
Client JSON cannot convey this process-local provenance.

The public contract workflow fetches public VibePro PR #577 at a fixed commit,
passes explicit paths to all three modules, and requires exactly four passes
with no skips. Run locally with:

```sh
BRAINBASE_PRODUCER_MODULE="$PWD/src/vibepro-contract/vibepro-managed-handoff.js" \
  node --test /path/to/vibepro/test/brainbase-producer-contract.test.js
node --test scripts/vibepro-tenant-boundary.node.mjs
```

UNS-36 approved extracting these reusable modules on 2026-11-03. The source
review found no embedded credentials, customer identifiers, or customer data.
Only the identity helper required by the three modules accompanies the extraction;
organization stores, HTTP runtime, deployment configuration and private packages
remain outside this directory. The public copy is independent: changes to the
private edition are not automatically synchronized.
