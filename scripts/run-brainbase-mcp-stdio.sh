#!/bin/bash
# Canonical stdio-only Brainbase MCP launcher for OpenAI Secure MCP Tunnel.
#
# tunnel-client inherits its own control-plane credentials. Strip those and
# every HTTP transport switch before starting Brainbase so the child process:
#   1. cannot accidentally bind a local HTTP listener, and
#   2. authenticates to Infisical through the Brainbase-specific credential
#      path instead of reusing the tunnel process token.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

unset MCP_HTTP_PORT MCP_HTTP_HOST MCP_HTTP_BEARER_TOKEN
unset CONTROL_PLANE_API_KEY OPENAI_MCP_TUNNEL_ID
unset INFISICAL_TOKEN
unset INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

exec "$SCRIPT_DIR/run-brainbase-mcp.sh" "$@"
