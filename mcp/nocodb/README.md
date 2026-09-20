# NocoDB compatibility package

The standalone NocoDB MCP server is retired. It is no longer registered in
the repository `.mcp.json`, has no launchd template, and its compatibility
launcher and `src/index.ts` exit with code `78` before loading credentials,
environment values, the MCP SDK, or a network transport.

The package remains only for migration compatibility and the canonical task
write-fence evidence:

- `src/nocodb-client.ts` retains the NocoDB client used by migration tooling
  and contract fixtures.
- `src/canonical-task-write-guard.ts` prevents direct mutation of the
  canonical Brainbase Tasks table and remains covered by
  `tests/canonical-task-write-guard.test.js`.
- The committed manifest and evidence registry are unchanged. Removing the
  MCP entry does not remove NocoDB data, migration scripts, or Infisical
  configuration.

Run the package tests to verify the write fence and retired entry:

```bash
npm test
```

Canonical Brainbase Tasks must use the canonical task API. Do not add a new
standalone NocoDB MCP registration or restore the old credential-based setup.
