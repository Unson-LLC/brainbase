#!/usr/bin/env node

/**
 * Standalone NocoDB MCP entrypoint retired.
 *
 * The NocoDB client and canonical write guard remain in this package for
 * migration evidence and contract tests. This entrypoint must not import the
 * MCP SDK or read NocoDB/Infisical environment values: an old launcher should
 * fail closed before it can create a transport or contact NocoDB.
 */

console.error(
  "NOCODB_MCP_RETIRED: use the canonical task APIs; standalone NocoDB MCP is no longer available",
);
process.exitCode = 78;
