# Runbook: Infisical Target Wrapper

Use this when an agent or runtime needs to choose an Infisical Org/project/env/path without hardcoding project IDs in each launcher.

The wrapper resolves only non-secret metadata from `config/infisical-targets.json` and optional local overrides at `~/.brainbase/infisical-targets.json`. Secret values must stay inside Infisical and runtime environment injection.

## List Targets

```bash
scripts/infisical-target-run.sh --list
```

## Inspect A Target

This prints Org/project/env/path/auth-file metadata only. It does not print secret values.

```bash
scripts/infisical-target-run.sh --target brainbase-mcp --json
```

## Check Runtime Injection

This starts `infisical run`, checks the configured `requiredKeys`, and exits without printing values.

```bash
scripts/infisical-target-run.sh --target brainbase-mcp --check
scripts/infisical-target-run.sh --target nocodb-mcp --check
scripts/infisical-target-run.sh --target slack-unson --check
```

For Org-specific local targets, keep the project mapping in `~/.brainbase/infisical-targets.json` and use the Org read-only Machine Identity file:

```bash
scripts/infisical-target-run.sh --target techknight-org-prod --check
scripts/infisical-target-run.sh --target salestailor-prod --check
```

Targets with no secrets registered yet can still pass `--check` when they have no `requiredKeys`. Treat `Injecting 0 Infisical secrets` as "auth and target resolution work, but this path is currently empty."

## Run A Command

```bash
scripts/infisical-target-run.sh --target brainbase-mcp -- npm run start
```

## Add A Local Target

Put local-only targets in `~/.brainbase/infisical-targets.json`, not in a repo `.env`.

```json
{
  "targets": {
    "example-prod": {
      "org": "unson",
      "projectId": "00000000-0000-0000-0000-000000000000",
      "env": "prod",
      "path": "/",
      "authFiles": ["@org:unson"],
      "requiredKeys": ["EXAMPLE_REQUIRED_KEY"]
    }
  }
}
```

Project IDs are not secret values, but local-only or partner-specific mappings can still stay outside the repository when the operating boundary is unclear.

Current local-only Org target names:

- `techknight-org-prod`
- `techknight-aitle-prod`
- `techknight-smartfront-prod`
- `techknight-senpainurse-prod`
- `salestailor-prod`

## Read-Only Machine Identities

Use one Universal Auth Machine Identity per Org for long-running non-interactive agents:

- Unson: `brainbase-ai-readonly-unson`
- TechKnight: `brainbase-ai-readonly-techknight`
- SalesTailor: `brainbase-ai-readonly-salestailor`

Org role must be `no-access`. Add the identity to each target Project with project role `viewer`.

Credential files:

```text
~/.brainbase/runtime-env/infisical.unson.universal-auth.env
~/.brainbase/runtime-env/infisical.techknight.universal-auth.env
~/.brainbase/runtime-env/infisical.salestailor.universal-auth.env
```

Each file must be mode `600` or `400`, and must never be printed or committed. A `no-access` Org role can make project-list APIs return 403; this is expected. Runtime injection should use allowlisted `projectId` values instead of project discovery.

## Project Config Isolation

The wrappers pass both the allowlisted `projectId` and the repository `config/`
directory as `--project-config-dir`. This prevents Infisical CLI from discovering
an unrelated `.infisical.json` in the current directory, a parent directory, or
the user's home directory. Override this isolation only by explicitly setting
`INFISICAL_PROJECT_CONFIG_DIR`.

## Existing MCP Launchers

These launchers now resolve their default Infisical target before running:

- `scripts/run-brainbase-mcp.sh`: `brainbase-mcp`
- `scripts/run-nocodb-mcp.sh`: `nocodb-mcp`
- `scripts/run-slack-mcp.sh unson`: `slack-unson`
- `scripts/run-slack-mcp.sh salestailor`: `slack-salestailor`
- `scripts/run-slack-mcp.sh techknight`: `slack-techknight`

Override with `INFISICAL_TARGET` or the launcher-specific variable:

```bash
BRAINBASE_MCP_INFISICAL_TARGET=example-prod scripts/run-brainbase-mcp.sh --check
NOCODB_MCP_INFISICAL_TARGET=example-prod scripts/run-nocodb-mcp.sh --check
SLACK_MCP_INFISICAL_TARGET=example-prod scripts/run-slack-mcp.sh unson --check
```
