# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 顧客固有の大田原オンボーディング文書を共通repoから分離する |
| Story ID | story-otawara-gws-customer-doc-separation |
| Run ID | 2026-10-17T055023Z |
| Gate | block |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| VP-TASK-NET-001 | VP-NET-001 | critical | 1件 | manual-review | todo |
| VP-TASK-STATIC-002-REVIEW | VP-STATIC-002 | high | 1件 | manual-review | todo |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-runtime-boundaries | todo |

## VP-TASK-NET-001: UI/API client callに対応するAPI routeが存在しない

- Source: finding / VP-NET-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/personal-knowledge.ts
- Target groups: -
- Read first: src/personal-knowledge.ts
- Recommended strategy: manual-review

完了条件:
- HTTP APIとして呼ぶなら app/api または pages/api にroute実体を追加する。Server Action / server functionのまま使う設計ならfetch置換を戻す。

## VP-TASK-STATIC-002-REVIEW: 秘密情報の可能性がある値が含まれている（要確認）

- Source: finding / VP-STATIC-002
- Execution: proposal_only / mutates_repository=false
- Target files: src/embedding-provider.ts
- Target groups: -
- Read first: src/embedding-provider.ts
- Recommended strategy: manual-review

完了条件:
- 公開前に該当値を削除し、必要な値はサーバー側または安全な環境変数管理へ移す。

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/foundation-authenticated-tools.ts
- Target groups: -
- Read first: src/foundation-authenticated-tools.ts, src/philosophy-revision-reader.ts, src/foundation-public-provider.ts, tests/foundation-authenticated-tools.test.ts, package.json, tests/foundation-adoption-tool.test.ts, docs/manual/reference/version-history.md, docs/specs/foundation-graph-adoption-v1.md
- Recommended strategy: split-runtime-boundaries

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。