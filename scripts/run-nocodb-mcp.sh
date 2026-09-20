#!/bin/bash
set -euo pipefail

# The standalone NocoDB MCP was retired. Keep this compatibility path
# fail-closed so an old launchd job cannot resolve credentials, import the
# server, or make a network request while it is being removed.
echo "NOCODB_MCP_RETIRED: use the canonical task APIs; standalone NocoDB MCP is no longer available" >&2
exit 78
