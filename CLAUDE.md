# brainbase Agent Instructions

**Version**: 2.1.0
**Last Updated**: 2026-08-30
**Maintainer**: Unson LLC

This file is the thin, always-loaded entrypoint for brainbase agents. Keep it under 200 lines. Put task-specific detail in Skills, commands, hooks, or docs.

## 0. Source Of Truth

- `CLAUDE.md` is the hand-authored project memory.
- `AGENTS.md` is the Codex-compatible mirror and must stay byte-for-byte identical.
- Do not manually diverge `AGENTS.md`.
- Do not use `@path` imports here for large documents; imports still consume startup context.
- If a rule must be enforced, prefer a hook/wrapper/check over a reminder.

## 0.5. Distribution Model（北極星・2026-07-11確定）

チームに配布されるものは2つだけ。それ以外はすべて佐藤インスタンスのホーム。

| 器 | 配るもの | 取得方法 |
|---|---|---|
| **brainbase-unson** (`code/brainbase`) | 組織の「動作」: server / Skills / Commands / Agents / hooks | メンバーが pull |
| **Graph SSOT** (PostgreSQL) | 組織の「事実」: エンティティ・関係・意思決定・RACI。正本ドキュメントへのポインタは **repo相対パスかURL**（個人の絶対パス禁止） | メンバーが query |
| **チームrepo群 + Drive** | 組織の「コンテンツ」: 事業ドキュメント = `{project}-project.git`（projects/はそのclone）、ブランド定義 = **Graph SSOT（entity_type: brand）**・ブランドアセット = **Google Drive**（GraphからURLポインタ）、組織横断ドキュメント = wiki | メンバーが pull / query / Drive |
| `~/workspace` ルート | 個人インスタンスのデータ: config.yml（repo→ローカル番地の個人番地録）・memory・個人の作業場（sns/ knowledge/ docs/ は佐藤専用運用と宣言、チーム資産に昇格した時点でrepo化）・var（runtime）・common/等のGraphミラー | 配布しない |

**判定**: 「これは他メンバーのマシンにもあるべきか？」→ YES+動作なら unson へ / YES+事実なら Graph へ / YES+コンテンツならチームrepo（事業→project repo、横断→wiki）へ / NO ならホームに残す。
個人のローカルパス・個人文脈をチームGraphに入れない（個人KG・config.ymlに entity_id/repo で紐付ける）。
ファイル共有（shared/・submodule方式）は廃止済みの敗れた仮説。復活させない。
**移設キュー（残存違反）**: root `.claude/` の組織的Skills/Commands（unson側と二重）、`settings/nocodb`（mana/Actionsが依存）、`common/frameworks/` 等の横断ドキュメント（→wiki）。

## 1. Behavioral Kernel

1. **Think Before Coding**: State assumptions and ambiguity. Ask only when a wrong guess is expensive.
2. **Simplicity First**: Make the smallest change that satisfies the request. Do not add speculative features.
3. **Surgical Changes**: Touch only files needed for the current intent. Do not clean up unrelated code.
4. **Goal-Driven Execution**: Define success, implement, verify, and complete the routine follow-through.
5. **Intent-to-Outcome North Star**: Turn the user's intent into a verified real-world outcome with the least necessary user cognitive load. Ask the user only for purpose, values, responsibility, authority, or information that cannot be safely derived; otherwise gather context, execute, verify, and retain reusable learning. Tools are replaceable means, not goals.
6. **Deterministic Code Before Model Judgment**: Use LLMs for open-ended semantic judgment, drafting, summarization, and extraction. Use code/hooks/guards for manifest-bounded classification, routing, retries, status handling, schema transforms, and other deterministic decisions.
7. **Token Drift Checkpoints**: In long work, restate what is done, verified, and left before continuing.
8. **Surface Conflicts, Do Not Average**: If sources or patterns disagree, choose the newer, more tested, or more authoritative one and explain why.
9. **Read Local Context Before Editing**: Read the target file, caller, shared utility, and relevant tests before adding code.
10. **Tests Verify Intent**: Tests should fail when the business rule breaks, not only when surface output changes.
11. **Checkpoint Significant Steps**: For multi-step work, keep progress recoverable and describable.
12. **Convention Beats Novelty**: Match the repo's existing style unless explicitly changing the convention.
13. **Fail Loud**: Do not report success when anything was skipped, unverified, inferred, or partially failed.

## 2. Execution Policy

- Execute routine work end-to-end without asking for confirmation: commit, push, restart, local verification, and established reflection/report flows.
- Ask only for destructive/irreversible actions, external sends/deletes/purchases/publication, high-cost ambiguous product intent, or missing information that cannot be discovered locally.
- Before implementation, use the relevant Skill or command; do not rely on memory when project guidance exists.
- One intent should become one focused commit. Stage only files touched for that intent.
- Never revert or overwrite unrelated user changes.
- If worktrees or sources conflict, stop blending and identify the authoritative source.

## 3. Brainbase Non-Negotiables

- **Graph SSOT first**: For people, orgs, customers, partners, projects, terms, decisions, and CRM facts, check brainbase Graph (`https://bb.unson.jp`) before writing or deciding. Use `brainbase-graph-philosophy-context`.
- **Judgment Resolver**: 各Codex turnはglobal Hostが1つのjudgment episodeとして管理する。`UserPromptSubmit`で生の会話履歴・current request・prior finalized episode・runtime/instruction bindingからcanonical contextを作り、model生成前に1つのjudgment episodeを開始して初期route receiptを採用する。現行Resolverは内部LLMを持たず、manifest-backed matcherで初期分類とDAGを決定する。専門matcher未一致の非follow-up入力はserver-owned `general/answer` fallbackへ解決し、参照先のないfollow-upやproject context不足のknowledge分類はclarificationへ送る。Codex modelはResolverを呼ばず、分類や文脈を作らない。返された`active_node_definitions`だけを実行し、結果からqueryを組み替えながらBrainbase knowledge/retrieval toolを0..N回呼べる。`PostToolUse`は実際のBrainbase callとowner表示行を原子的なjournal commit順で記録し、`Stop`が最終回答先頭に保存済み`🧠`・`📚`・`⚠️`行がその順序で各一回表示されたことを検査してcomplete episode receiptを1件だけ確定する。修復可能なStopが回答を差し戻した場合はjournalに記録されたStop修復だけを最終監査へ表示し、AIの自己申告は拒否する。required `knowledge.resolve`の未実行またはowner表示不完全なら最初の修復可能なStopで`decision:block`を返し、finalを作らない。それでも不完全なactive再Stopは`judgment_stop_repair_exhausted`で非zero終了し、無限再生成を防ぐ。Brainbase callが0件で参照必須でないturnも0件だったことを明示する。episodeのないorphan Stopも成功へ潰さない。clarification receiptでも回答生成へ進む。project bindingは判断文脈であり、project access不能だけで判断を止めない。episode receiptはaction許可ではなく、通常の権限・承認を置き換えない。Claude Codeは将来のHost adapter候補であり、現行episode lifecycle hook integrationには含まれない。詳細は`brainbase-judgment-resolver`。
- **Outcome continuation**: A `continue` receipt must not finalize an implement/operate request that only describes pending remediation. Stop records `unfinished_safe_work`, shows the distinct `🔁 未完了` progress line, and requires the journal-bound `🔁 実行継続` completion line after safe work continues.
- **Capability map first**: For Brainbase capability, project/session creation, auth grant, port `31013`, launchd runtime, terminal/xterm transport, or "not visible/not working" issues, use `brainbase-capability-map`.
- **Skills first**: Load only the smallest relevant Skill. Do not bulk-load Skill folders.
- **Local vs Lightsail matters**: For `/oyasumi` Graph/candidate writes, use the canonical local control-plane path backed by the Lightsail tunnel, not an accidental local database. Wiki writes are retired.
- **Multi-account ops**: `/ohayo` must check all configured Gmail/Calendar accounts and Slack workspaces per command/Skill guidance.
- **VibePro / Brainbase boundary**: Brainbase is the authority for organization judgment, knowledge, development conventions, infrastructure/secret locations, and reusable learning. VibePro is a repository-local aid for one accepted change: Story -> Spec -> implement -> affected tests -> one review wave -> GitHub PR -> CI -> merge. Architecture and Graphify are conditional, and normal repository PR/permission rules remain authoritative.
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
| Judgment routing | `brainbase-judgment-resolver` |
| Brainbase capabilities | `brainbase-capability-map` |
| NocoDB | `nocodb-guide`, `nocodb-4table-guide` |
| Daily ops | `/ohayo`, `/oyasumi`, `daily-reflection`, `slack-mentions` |
| Evidence-safe reports and automation | `docs/policies/evidence-safe-automation.md` |
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

<!-- VIBEPRO_CODEX_START -->
## VibePro Codex Operating Rules

Use VibePro as a small repository-local aid for keeping one accepted change connected from Story to Spec, implementation, verification, review, and PR handoff.

VibePro is not a workflow engine, merge authority, safety decision engine, agent sandbox, or evidence-collection game. Do not rebuild retired mechanisms through repository instructions.

The standard loop is:

> Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge

When a repository uses VibePro:

- Start from one focused Story with one user-visible outcome and explicit acceptance criteria.
- Keep Program, roadmap, portfolio, and organization policy outside the Story. Link to their canonical source instead of copying them.
- Add or update an Architecture/ADR only when the accepted change materially alters a system boundary, ownership, data contract, security boundary, deployment model, or rollback strategy. Architecture is not a mandatory ceremony for every Story.
- Use `vibepro story diagnose <repo> --id <story-id> --run-graphify` only when code or graph evidence changes the implementation or test decision. Graphify is optional.
- Write the smallest Spec that makes the accepted behavior and invariants testable.
- During implementation, run only tests affected by the change. The full suite belongs in CI unless the change can only be proven by a local release rehearsal.
- Run at most one review wave after implementation is stable. Use no more than three independent roles in parallel and no more than five total review dispatches.
- A finding blocks only when it demonstrates an unmet acceptance criterion, security or tenant-boundary violation, data corruption/loss risk, unsafe changed release/rollback path, or inability of CI to validate the change.
- Fix a blocking finding and reverify only the affected surface. Treat that delta confirmation as part of the same review wave.
- Move every useful non-blocking finding to a follow-up Story or Issue instead of expanding the current Story.
- Treat reviewer timeout, empty output, wrong request, or execution failure as a review-system failure, not as a product defect.
- `vibepro pr prepare <repo> --story-id <story-id>` may generate a concise Story, Spec, verification, and review summary. Any legacy Gate, readiness, lifecycle, or stale-review projection in that output is informational only and must not create new work or block the PR.
- Open or refresh the PR through the repository's normal GitHub flow, including `gh pr create` where that is the repository convention. `vibepro pr create` is optional convenience, not required authority.
- Let CI run the full suite. Fix only failures caused by the proposed change.
- Merge only through the repository's normal review and permission boundary. VibePro does not authorize deploys, production writes, secret access, or external actions.

Do not use or require retired contracts such as:

- `vibepro execute start`
- managed worktree execution as a prerequisite
- a general-purpose Gate DAG
- `vibepro review authorize`, `review start`, `review close`, or `review repair`
- mandatory Agent Review Gate dispatch
- lifecycle or token-budget accounting
- automatic audit bundles
- raw `gh pr create` prohibition

For bug fixes, use the repository's current VibePro bug diagnosis contract when it applies, then return to the same minimal loop. For repository-local decisions, the target repository's own `AGENTS.md` remains authoritative; this managed block only defines VibePro-specific behavior.
<!-- VIBEPRO_CODEX_END -->
