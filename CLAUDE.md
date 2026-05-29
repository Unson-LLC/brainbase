# brainbase Agent Instructions

**Version**: 2.0.0
**Last Updated**: 2026-05-11
**Maintainer**: Unson LLC

This file is the thin, always-loaded entrypoint for brainbase agents. Keep it under 200 lines. Put task-specific detail in Skills, commands, hooks, or docs.

## 0. Source Of Truth

- `CLAUDE.md` is the hand-authored project memory.
- `AGENTS.md` is the Codex-compatible mirror and must stay byte-for-byte identical.
- Do not manually diverge `AGENTS.md`.
- Do not use `@path` imports here for large documents; imports still consume startup context.
- If a rule must be enforced, prefer a hook/wrapper/check over a reminder.

## 1. Behavioral Kernel

1. **Think Before Coding**: State assumptions and ambiguity. Ask only when a wrong guess is expensive.
2. **Simplicity First**: Make the smallest change that satisfies the request. Do not add speculative features.
3. **Surgical Changes**: Touch only files needed for the current intent. Do not clean up unrelated code.
4. **Goal-Driven Execution**: Define success, implement, verify, and complete the routine follow-through.
5. **Deterministic Code Before Model Judgment**: Use LLMs for classification, drafting, summarization, and extraction. Use code/hooks/guards for routing, retries, status handling, schema transforms, and other deterministic decisions.
6. **Token Drift Checkpoints**: In long work, restate what is done, verified, and left before continuing.
7. **Surface Conflicts, Do Not Average**: If sources or patterns disagree, choose the newer, more tested, or more authoritative one and explain why.
8. **Read Local Context Before Editing**: Read the target file, caller, shared utility, and relevant tests before adding code.
9. **Tests Verify Intent**: Tests should fail when the business rule breaks, not only when surface output changes.
10. **Checkpoint Significant Steps**: For multi-step work, keep progress recoverable and describable.
11. **Convention Beats Novelty**: Match the repo's existing style unless explicitly changing the convention.
12. **Fail Loud**: Do not report success when anything was skipped, unverified, inferred, or partially failed.

## 2. Execution Policy

- Execute routine work end-to-end without asking for confirmation: commit, push, restart, local verification, and established reflection/report flows.
- Ask only for destructive/irreversible actions, external sends/deletes/purchases/publication, high-cost ambiguous product intent, or missing information that cannot be discovered locally.
- Before implementation, use the relevant Skill or command; do not rely on memory when project guidance exists.
- One intent should become one focused commit. Stage only files touched for that intent.
- Never revert or overwrite unrelated user changes.
- If worktrees or sources conflict, stop blending and identify the authoritative source.

## 3. Brainbase Non-Negotiables

- **Graph SSOT first**: For people, orgs, customers, partners, projects, terms, decisions, and CRM facts, check brainbase Graph (`https://bb.unson.jp`) before writing or deciding. Use `brainbase-graph-philosophy-context`.
- **Capability map first**: For Brainbase capability, project/session creation, auth grant, port `31013`, launchd runtime, terminal/xterm transport, or "not visible/not working" issues, use `brainbase-capability-map`.
- **Skills first**: Load only the smallest relevant Skill. Do not bulk-load Skill folders.
- **Local vs Lightsail matters**: For `/oyasumi` Decision/Wiki writes, POST through local `http://localhost:31013`; DB access must be the Lightsail tunnel, not an accidental local database.
- **Multi-account ops**: `/ohayo` must check all configured Gmail/Calendar accounts and Slack workspaces per command/Skill guidance.
- **VibePro**: For VibePro work, use Story -> Architecture -> Spec -> Task -> Code -> Gate -> PR. Do not bypass VibePro PR/Gate flows with raw `gh pr create`.
- **UI/runtime claims require evidence**: When saying something works, cite the file, API, process, log, test, or screenshot used to verify it.

## 4. Skill Routing

Use these entrypoints instead of keeping detailed rules in this file:

| Work type | Skill / command |
|---|---|
| Architecture patterns | `architecture-patterns` |
| TDD / test strategy | `tdd-workflow`, `test-strategy` |
| Debugging | `verify-first-debugging` |
| Refactoring | `refactoring-workflow` |
| Security | `security-patterns` |
| Git, commit, merge, worktree | `git-workflow`, `git-commit-rules`, `branch-worktree-rules` |
| VibePro | `vibepro-workflow`, `vibepro-human-review`, `vibepro-story-refactor` |
| Graph SSOT | `brainbase-graph-philosophy-context` |
| Brainbase capabilities | `brainbase-capability-map` |
| NocoDB | `nocodb-guide`, `nocodb-4table-guide` |
| Daily ops | `/ohayo`, `/oyasumi`, `daily-reflection`, `slack-mentions` |
| Frontend UI quality | `design-taste-frontend`, `redesign-existing-projects`, `ui-design-resources` |
| Worktree dev server | `worktree-dev-server`, `dev-server-worktree` |

## 5. Development Commands

Prefer targeted commands first:

```bash
npm run test:run -- <test-file>
npm run typecheck
npm run test:e2e
npm run dev
```

For Git/JJ flows, follow `git-workflow` and `git-commit-rules`. Do not use `git add -A` for mixed worktrees; explicitly stage the files for the current intent.

## 6. CLAUDE.md / AGENTS.md Maintenance

- Keep both files under 200 lines.
- Keep both files identical: `cmp -s CLAUDE.md AGENTS.md`.
- Move detailed procedures to Skills, commands, hooks, or docs.
- Update Skill references when removing sections from this file.
- Validate changes with:

```bash
wc -l CLAUDE.md AGENTS.md
cmp -s CLAUDE.md AGENTS.md
git diff --check
```

## 7. Official Guidance

- Claude Code memory / CLAUDE.md: https://code.claude.com/docs/en/memory
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings
