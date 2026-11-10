# Preview the Codex MCP configuration

A user previews the Brainbase MCP entry without saving a host configuration file.

## Sub-features

- `install-preview-output`: print the Codex MCP configuration for this local directory.
- `install-preview-no-write`: confirm the requested output path remains absent and scratch files are unchanged.

## How to get to it (user POV)

Run `brainbase onboard:install --target codex --dry-run`. Source checkouts use `node dist/cli.js`.

## Driving it with verify.mjs

Preconditions: the helper has seeded its owned directory and recorded its scratch file hashes. Run the helper using Launch in ../SKILL.md.

- Preview: `node dist/cli.js onboard:install --dir <owned-directory> --target codex --dry-run --output <owned-scratch>/must-not-exist.toml`.
- Inspect: require exit 0, output containing `brainbase` and the exact owned data directory.
- Confirm no write: compare complete scratch file hashes before and after. The output path is included in that tree and must remain absent. Capture the output and both manifests in `install-preview.json`.

## Gotchas

This is a preview only. It does not install MCP, restart Codex, merge a real configuration, or prove agent usefulness. Claude and CodeCode previews and actual configuration writes are unverified. Do not infer that another command's dry-run has the same behavior.
