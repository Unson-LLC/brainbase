# Local Brainbase verification map

The primary verified surface is the local CLI and stdio MCP server. Web UI, real agent installation and first value, source imports, Graph search/resolution, and organization services remain outside this seed map. Do not use a pass here as proof for those surfaces.

## Preconditions and conventions

Use the Launch command in ../SKILL.md from a clean checkout. The helper owns an empty, unique local directory and fixed synthetic data. It strips inherited service configuration. Read doctor and identity evidence before trusting a drive. Every run needs a new evidence directory. Failed prerequisites fail the journey; never skip them to obtain PASS.

## Features

- [cli-seed](cli-seed.md): initialize, register synthetic owner context, list memories, read stored files.
- [install-preview](install-preview.md): preview the Codex configuration while proving the output file was not created.
- [mcp-readback](mcp-readback.md): discover public tools and read the saved project, context, and backend status from a fresh server.

Each feature uses the executable `scripts/verify.mjs` from the parent skill. All three are run by its one invocation. The transcript identifies individual CLI commands and MCP tool calls. Proof includes requests and resulting values, persisted file hashes, exit codes, and cleanup. Evidence survives failed and successful runs. Do not mark unmapped entry points as covered.
