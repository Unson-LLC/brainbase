# brainbase Agent Instructions

**Version**: 2.2.0
**Last Updated**: 2026-09-20
**Maintainer**: Unson LLC

This file is the thin, always-loaded entrypoint for brainbase agents. Keep it under 200 lines. Put task-specific detail in Skills, commands, hooks, or docs.

## 0. Source Of Truth

- `CLAUDE.md` is the hand-authored project memory.
- `AGENTS.md` is the Codex-compatible mirror and must stay byte-for-byte identical.
- Do not manually diverge `AGENTS.md`.
- Do not use `@path` imports here for large documents; imports still consume startup context.
- If a rule must be enforced, prefer a hook/wrapper/check over a reminder.

## 0.5. Distribution Model

- 他メンバーにも必要な動作は所有する配布repo、事実はGraph SSOT、レビュー済み文書は所有repoの`docs/`、素材はDrive、個人データは個人ホームへ置く。
- 個人の絶対パスや個人文脈をチームGraphへ入れない。正本へのポインタはrepo相対パスかURLを使う。
- Wiki、`shared/`、`_codex/`、submodule共有は復活させない。既存資産の移設は所有元を確かめ、今回の依頼範囲で扱う。

## 1. 作業の目的と完了

- 依頼の成果と完了条件を押さえ、必要な実装・検証・通常のGit手続きまで進める。最初の実装や計画の提示だけで止めない。
- 今回の変更に必要なファイルと関係だけを読む。サービス境界なら `architecture-patterns`、スキーマや認証なら該当実装と契約、配備なら現行の運用手順を参照する。
- 変更した振る舞いを検証できる範囲を選ぶ。通過後は、新しい変更・失敗・未解決の懸念がなければ同じ検証を繰り返さない。
- ソース間に矛盾があれば正本と現行の実装を確認する。推測、未確認、部分成功を確認済みの成果と混ぜない。
- 意味の判断はモデル、再試行・状態遷移・スキーマ変換など決定的な処理はコードに置く。

## 2. Execution Policy

- Execute routine work end-to-end without asking for confirmation: commit, push, restart, local verification, and established reflection/report flows.
- Ask only for destructive/irreversible actions, external sends/deletes/purchases/publication, high-cost ambiguous product intent, or missing information that cannot be discovered locally.
- 該当するSkillまたはコマンドの入口を読み、必要な分岐だけを選ぶ。参照資料を一括で読む必要はない。
- When the Judgment Resolver fixes `classification.intent=implement`, use `vibepro-workflow` before changing code even if the user did not mention VibePro. Create or select one focused Story and its smallest testable Spec first. Debugging, TDD, and Git Skills run inside this loop; they do not replace it.
- One intent should become one focused commit. Stage only files touched for that intent.
- Never revert or overwrite unrelated user changes.
- If worktrees or sources conflict, stop blending and identify the authoritative source.

## 3. Brainbase Non-Negotiables

- **Graph SSOT first**: For people, orgs, customers, partners, projects, terms, decisions, and CRM facts, check brainbase Graph (`https://bb.unson.jp`) before writing or deciding. Use `brainbase-graph-philosophy-context`.
- **Judgment Resolver**: Codex turnの冒頭はHostの指示に従い、`brainbase_resolve_turn`へ `turn_ref` と意味解釈を渡す。返されたTurnContractを保ち、詳細が必要な場合は `brainbase-judgment-resolver` を読む。監査表示と完了状態は現行Hostの契約に従う。receiptは操作の許可ではない。
- keyword matcherは義務・action floor・riskを追加できるが、未一致を`general/answer`へ落としたり必要能力を減らしたりしない。
- **Outcome continuation**: `continue`の実装・操作依頼は、許可済みで実行可能な作業と検証を終えてから完了する。未処理を完了状態にしない。
- **Capability map first**: For Brainbase capability, project/session creation, auth grant, port `31013`, launchd runtime, terminal/xterm transport, or "not visible/not working" issues, use `brainbase-capability-map`.
- **Skills**: 起動条件が今回の作業に合うものだけを使う。明示指定されたSkillは読む。一般的な説明、固定フェーズ、モデル固有の思考手順を増やさず、入出力・権限・成功条件・固有の注意点を残す。
- **Local vs Lightsail matters**: For `/oyasumi` Graph/candidate writes, use the canonical local control-plane path backed by the Lightsail tunnel, not an accidental local database. Wiki writes are retired.
- **Multi-account ops**: `/ohayo` must check all configured Gmail/Calendar accounts and Slack workspaces per command/Skill guidance.
- **VibePro / Brainbase boundary**: Brainbase is the authority for organization judgment, knowledge, development conventions, infrastructure/secret locations, and reusable learning. VibePro is a repository-local aid for one accepted change: Story -> Spec -> implement -> affected tests -> one review wave -> GitHub PR -> CI -> merge. Architecture is conditional; installed Graphify receives a lightweight lookup for every implementation, and normal repository PR/permission rules remain authoritative.
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

変更に関係するコマンドを選ぶ。これは全項目の必須実行リストではない。外部へ影響しないと確認できたローカル検証と、その変更が原因の修正・再検証は追加確認なしで進める。

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
- For every implementation regardless of size, use the lightweight Graphify lookup in `docs/brainbase-capabilities/runbooks/vibepro-impact-review.md` when installed. Reuse unchanged results; update or deepen only when needed. Missing or incomplete evidence is unknown, not no impact. Do not add a PR gate.
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
