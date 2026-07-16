---
story_id: story-brainbase-web-ui-retirement-v1
title: Brainbase Web UI retirement and Agent-first surface migration
source_requirement:
  type: product_direction
  description: CodexとClaude CodeからMCPで扱える能力のWeb UIを廃止し、Webをlogin、interactive settings、pairing、recoveryへ限定する。
architecture_docs:
  - path: docs/architecture/ADR-017-agent-first-product-surface.md
    status: accepted
  - path: docs/architecture/brainbase-surface-responsibility-matrix.md
    status: accepted
related_tasks: []
status: draft
created_at: 2026-07-16
updated_at: 2026-07-16
---

# Brainbase Web UI retirement and Agent-first surface migration

## Background

BrainbaseはMCPを通じてCodexとClaude Codeから十分に利用できる。専用Web UIの維持はAPIとUIの二重実装を生み、小さなバグ、低いUX、状態同期不良、回帰テスト負担によって、本来のGraph、Workflow、実行、監査、学習の価値への到達を妨げている。

ユーザーの日常操作をWebへ増やすのではなく、Agent-firstへ移行し、UI開発コストをMCP能力、データ品質、信頼性、自動化、学習ループへ再配分する。

## User story

Brainbase operatorとして、CodexまたはClaude CodeからBrainbaseの能力を安全かつ完全に利用し、人間の注意が必要な項目だけをMac Companionで受け取りたい。Web画面の導線、表示不具合、画面固有の状態管理に依存せず、Brainbaseの価値へ直接到達するためである。

## Target state

- Brainbase CoreはUIに依存しないAPI/MCP/ledger/auditを正本とする。
- Codex/Claude Codeは検索、更新、実行、診断、管理の標準操作面となる。
- Mac Companionは通知、承認、修正、feedbackに限定する。
- Brainbase Webはlogin、interactive consent、bootstrap、pairing、break-glass recoveryだけを提供する。
- Codex/Claude Codeでできる操作と日常一覧画面はWebから廃止する。

## Initial Web inventory

分類は機能単位で行う。`temporarily_keep`は移管未確認を意味し、長期残置を意味しない。

| Current artifact | Current role | Target | Initial state | Retirement condition |
|---|---|---|---|---|
| `public/index.html` | Workspace、Project、Session等の主要shell | MCPへ移管。login/bootstrapだけ分離してWebに残す | `temporarily_keep` | shell内能力のMCP parity確認とauth/bootstrap分離 |
| `public/workflows.html` | Workflow Mission Control、Run Detail、Agent Run Inbox | Core + MCP + Mac Companion | `temporarily_keep` | workflow/runのMCP操作、要介入runのCompanion投影、監査参照を検証 |
| `public/meeting-workflow-pack.html` | Meeting Packの設計・確認 | MCP + Mac Companion | `temporarily_keep` | pack操作のMCP化と承認projectionのCompanion検証 |
| `public/sns-growth.html` | SNS運用cockpit | MCP/automation + Mac Companion approval | `temporarily_keep` | 生成・計測・投稿準備のMCP/automation化と承認境界を検証 |
| `public/admin.html` | 管理・可視化の混合面 | browser必須設定だけWebへ分離し、残りはMCP | `temporarily_keep` | admin能力を機能別分類し、auth/consent/recovery以外を移管 |
| `public/setup.html` | 初期設定 | Web候補 | `keep_web_review` | 各設定についてブラウザ必須理由を確認し、不要項目をMCPへ移管 |
| `public/device.html` | device接続・pairing | Web候補 | `keep_web_review` | pairing/本人確認に必要な最小面へ縮小 |
| `public/test-infrastructure.html` | 開発・検証用UI | CLI/test artifact | `delete_candidate` | production導線と運用依存がないことを確認 |
| `public/ttyd/custom_ttyd_index.html` | browser terminal shell | Codex/Claude Code native surface | `temporarily_keep` | session/runtime復旧用途を監査し、代替経路を確認 |
| `public/ttyd/ttyd_index.html` | browser terminal shell | Codex/Claude Code native surface | `temporarily_keep` | session/runtime復旧用途を監査し、代替経路を確認 |

この一覧は削除許可の正本であり、ソースにproduction surfaceが追加・発見された場合は削除作業より先に追記する。

## Acceptance criteria

- [ ] ac:1 全production Web surfaceと主要導線がinventoryに登録されている。
- [ ] ac:2 各surfaceの全能力が`move_to_mcp`、`move_to_companion`、`automate`、`keep_web`、`delete`へ機能単位で分類されている。
- [ ] ac:3 `move_to_mcp`は正常系、認証・project scope、不正入力、依存先 unavailable、監査証跡までcurrent HEADで検証されている。
- [ ] ac:4 `move_to_companion`は要介入項目と根拠を表示し、blocked/unconfirmed/no_data/取得不能を0件や成功へ丸めない。
- [ ] ac:5 `keep_web`はブラウザ必須理由を持ち、login、consent、bootstrap、pairing、break-glass recoveryの範囲を超えない。
- [ ] ac:6 廃止対象画面への新規導線と新機能追加を禁止し、後継面でのみ新規能力を提供する。
- [ ] ac:7 画面削除は専用client/state/view/test/route/assetsの影響を確認し、画面単位の小さな変更として実施する。
- [ ] ac:8 各削除PRは後継面のevidence、削除対象、残存互換性、rollback方法を記録する。
- [ ] ac:9 Web UIを完成条件にしている既存Story/ADRがAgent-first境界へ更新されている。
- [ ] ac:10 Web削除後もCore API/MCP、台帳、audit、connectorは維持され、UI削除をドメイン削除に拡大しない。

## Migration slices

1. **Freeze**: 廃止対象Web UIへの新機能追加を止める。
2. **Inventory**: route、page、client、state、API、test、auth、deep-linkを能力単位で棚卸しする。
3. **MCP parity**: 日常操作と管理操作をMCPへ揃える。
4. **Companion focus**: 承認・要介入projectionをMac Companionへ揃える。
5. **Web core extraction**: login/consent/bootstrap/pairing/recoveryを独立した最小surfaceへ分離する。
6. **Retire by surface**: evidenceを満たした画面から導線、page、専用コード、専用testを削除する。
7. **Cost removal**: 廃止UI専用のVisual/E2E gate、assets、互換routeを削減する。

## Scope exclusions

- このStoryではWeb UIコードを直ちに削除しない。
- Brainbase Coreのドメインモデル、API、MCP、ledger、auditを削除しない。
- Mac Companionを汎用管理画面へ拡張しない。
- MCP parity未確認の能力を「不要」と推定して削除しない。
- login、OAuth/consent、pairing、break-glass recoveryの最終デザインを確定しない。

## Immediate follow-up stories

1. Web surface/code-path inventory and dependency map
2. Workflow/Run/Agent Run Inbox MCP parity
3. Agent Run Inbox Mac Companion focus projection
4. Auth/settings/recovery Web core extraction
5. Surface-by-surface retirement starting with isolated developer-only UI
