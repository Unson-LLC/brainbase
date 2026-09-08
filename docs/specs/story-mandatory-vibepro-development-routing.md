# Spec: 開発依頼のVibePro必須ルーティング

## 対象

- `scripts/codex-hooks/judgment-resolver-host.mjs`
- `.claude/skills/vibepro-workflow/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`
- `tests/unit/judgment-resolver-host.test.js`
- `tests/unit/vibepro-minimal-core-contract.test.js`

## 契約

### C-1: implement分類からVibePro最小ループへ接続する

Hostが受領したimmutable route receiptの`classification.intent`が`implement`の場合、`UserPromptSubmit`の追加文脈は次を要求する。

1. `vibepro-workflow`を最初の開発Skillとして使う。
2. 利用者がVibeProと明記していなくても適用する。
3. コード変更前に一つのStoryと、受け入れ条件を検証可能にする最小Specを作成または選択する。
4. その後にdebugging、TDD、Git Skillを内側の実装手段として使う。
5. 影響テスト、最大一回のreview wave、通常のGitHub PR/CI/mergeへつなぐ。

### C-2: 非implementへ誤適用しない

`classification.intent !== implement`のturnにはC-1の指示を追加しない。運用、調査、診断、回答をStory化する副作用を避ける。

### C-3: authority境界を変えない

VibeProはrepository-localな開発補助であり、Brainbaseの組織判断、権限、knowledge authority、通常のPR・merge境界を置き換えない。退役済みのgeneral-purpose Gate DAGやmanaged worktree必須契約を再導入しない。

## 検証

- Host unit test: implement receiptだけに必須指示が含まれる。
- Host unit test: diagnose receiptに必須指示が含まれない。
- Minimal Core contract test: `AGENTS.md`と`CLAUDE.md`が同一で、明示の有無に依存しないimplementルーティングを含む。
- `cmp -s CLAUDE.md AGENTS.md`
- `git diff --check`

## Rollback

Hostのimplement向け追加文脈、常時指示、対応テストと本Spec/Storyを同一PRでrevertする。intent分類や既存episode receipt schemaには変更がないため、データ移行は不要。
