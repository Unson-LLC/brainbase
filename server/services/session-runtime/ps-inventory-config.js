/**
 * Maximum stdout buffer for full-command `ps -axo ...command=` inventory scans.
 *
 * Node's child_process exec/execSync default maxBuffer is 1 MB. The full command
 * column includes every process's complete argv, so on a busy host (many
 * claude/codex/node sessions with long worktree paths and arguments) the output
 * can cross 1 MB intermittently. When it does, the call throws
 * "stdout maxBuffer length exceeded"; the runtime inventory and the terminal
 * reconciler then silently observe zero processes, which both spams warn logs and
 * can drive false "missing/stale ttyd" reconciliation.
 *
 * Use a generous bound so process observation never fails purely for output size.
 */
export const PS_INVENTORY_MAX_BUFFER = 64 * 1024 * 1024;
