# Read owner context through MCP

An MCP client discovers Brainbase tools and reads the context saved by the user-facing CLI.

## Sub-features

- `mcp-discovery`: discover the public tool names through a real stdio server.
- `mcp-project`: list the saved project through `list_entities`.
- `mcp-context`: recover the saved value through `get_context`.
- `mcp-status`: confirm a connected local backend and unchanged canonical files.

## How to get to it (user POV)

Connect an MCP client to `node dist/index.js`, then invoke the public tools. This map covers the protocol entry point; a real Codex or Claude host is a separate unverified entry point.

## Driving it with verify.mjs

Preconditions: CLI seed and disk readback have succeeded. Run the helper using Launch in ../SKILL.md.

- Connect: create the SDK `StdioClientTransport` with `node dist/index.js`, local mode, and the owned data directory. Require a successful MCP initialization.
- Discover: `tools/list` must include `list_entities`, `get_context`, and `onboarding_status`.
- Project: `tools/call` with `list_entities` and `{"type":"project"}` must return `Local verification project`.
- Context: `tools/call` with `get_context` and `{}` must return `Keep verification local`.
- Status: `tools/call` with `onboarding_status` and `{}` must report `localBackend.connected: true`.
- Preserve: close the client, compare canonical file hashes with the pre-read snapshot, and require equality. Capture requests, responses, stderr, and cleanup.

## Gotchas

Never attach to a shared server. The helper creates and closes its own child. A tool error or absent text content fails the journey. A connected backend does not prove Graph retrieval or the human first-value gate. Search and entity resolution are not driven by this recipe.
