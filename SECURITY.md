# Security Policy

## Scope

Brainbase MCP v1 is a local-first package. It does not require hosted backends, Infisical, bb.unson.jp, Lightsail, API keys, OAuth tokens, or Unson internal data.

The default runtime reads canonical local files under `~/.brainbase/personal-os/` or the path supplied through `BRAINBASE_PERSONAL_OS_DIR`.

## Supported Checks

Before release or contribution, run:

```bash
npm run build
npm test
npm audit
npm pack --dry-run --json
```

For public package publication, use:

```bash
npm publish --access public
```

`package.json` includes `publishConfig.access=public` so scoped package publication does not accidentally default to private package semantics.

`npm pack --dry-run --json` should include only the package runtime and public docs:

- `dist/`
- `README.md`
- `LICENSE`
- `SECURITY.md`
- `package.json`

It must not include personal SSOT files, raw sources, UI artifacts, internal operation scripts, VibePro workbench files, or secrets.

## Local Data

Do not commit files from:

- `~/.brainbase/personal-os/`
- Any directory used as `BRAINBASE_PERSONAL_OS_DIR`
- `sources/` directories that contain raw personal notes, logs, or meeting transcripts

The repository templates and tests must use synthetic fixture data only.

## Reporting Security Issues

Report security issues through GitHub:

https://github.com/Unson-LLC/brainbase/issues

Do not include credentials, personal SSOT content, private meeting notes, or raw logs in public issues.

## Best Practices

- Keep local MCP mode secret-free.
- Use placeholders in documentation and fixtures.
- Prefer canonical local SSOT files over raw source material.
- Treat hosted backends and remote sync as future optional integrations, not v1 behavior.
- Keep `.vibepro/`, `node_modules/`, `dist/`, coverage output, and local test scratch directories out of git.
