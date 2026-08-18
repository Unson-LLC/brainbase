---
adr_id: ADR-017
title: Agent-first product surface and Web UI retirement
status: accepted
date: 2026-07-16
related_stories:
  - story-brainbase-web-ui-retirement-v1
  - story-workflow-product-retirement-v1
  - story-brainbase-workflow-mission-control
  - story-cross-runtime-run-receipt-inbox-v1
  - story-companion-approval-inbox-v1
related_docs:
  - docs/architecture/brainbase-surface-responsibility-matrix.md
  - docs/architecture/workflow-product-retirement-architecture.md
  - docs/stories/story-brainbase-web-ui-retirement-v1.md
  - docs/decisions/2026-08-18_intent-to-outcome-north-star.md
supersedes:
  - ADR-015
superseded_by: []
---

# ADR-017: Agent-first product surface and Web UI retirement

## Context

Brainbaseの価値は、Graph SSOT、Workflow/Task/Run台帳、MCP、認証・認可、外部接続、監査証跡、学習ループにある。現在、検索、登録、更新、実行、状態確認、診断の多くはBrainbase MCPを通じてCodexやClaude Codeから利用できる。

同じ能力をWeb UIでも提供すると、APIと画面の二重実装、状態管理、エラー表示、レスポンシブ対応、アクセシビリティ、Visual/E2E回帰、認証境界、API変更への追従が継続的に発生する。小さな表示不具合や低いUXがBrainbase本来の能力への到達を妨げ、UIの維持コストがControl Planeの信頼性、MCP能力、データ品質、自動化、学習ループへの投資を奪っている。

これは個別画面の品質問題ではなく、標準操作面をどこに置くかというプロダクト境界の問題である。

## Decision

BrainbaseをGUI-firstなWebアプリとして提供する方針を終了し、Agent-firstなControl Planeとして運用する。

本方針の上位目的は、`docs/decisions/2026-08-18_intent-to-outcome-north-star.md`で定めた「自分の意思を、最小の認知負荷で、継続的に現実へ変える」である。Agent-first、MCP、Mac Companion、Graph、各種台帳はその目的を実現する手段として評価し、利用や維持そのものを目的にしない。

標準操作面は次のように固定する。

- CodexおよびClaude CodeからMCPで安全に実行できる操作には、専用Web UIを作らない。
- 完全自動化できる処理には、人間向けUIを作らない。
- 人間の注意、即時確認、承認、修正が必要な項目はMac Companionへ投影する。
- Webはログイン、OAuth/接続同意、権限付与、端末ペアリング、MCP停止時の最小復旧など、ブラウザまたは対話的本人確認が不可欠な面だけを持つ。bootstrap configはMCP/CLIが所有する。
- 「設定」という名称だけではWeb残置の理由にならない。Codex/Claude CodeからMCPで安全に変更・検証できる設定はWebから廃止する。
- `Workflow`を人間が作成・編集・公開する汎用製品として提供する方針を終了する。汎用Workflow CRUD、draft/test/publish、manual runをMCPへ移植しない。
- Meeting Packの実行経路とRun/Run Receipt/Human Approval/Auditは`Meeting Automation`と`Automation Run Core`へ分離して維持する。移行中の内部class、route、ledger fieldに残る`workflow`名は互換実装であり、製品面の継続を意味しない。

廃止するのはWeb上の重複した操作面であり、対応するドメイン能力、API、MCP tool、台帳、イベント、監査証跡ではない。

## Product boundary

```text
Brainbase Core
  = Graph / Automation Run / Run Receipt / API / MCP / ledger / auth / connectors / audit / learning

Codex + Claude Code
  = search / mutate / execute / inspect / diagnose / administer

Mac Companion
  = notify / focus / approve / correct / give feedback

Brainbase Web
  = login / interactive consent / pairing / break-glass recovery
```

## Retirement rule

各Web画面は、機能単位で次の順序を満たした後に削除する。

1. 画面が提供する操作、読み取り、権限、失敗状態、復旧経路を棚卸しする。
2. 各能力を`move_to_mcp`、`move_to_companion`、`automate`、`keep_web`、`delete`へ分類する。
3. 後継面で同等以上の権限境界、明示的失敗、監査証跡、復旧可能性を検証する。
4. 旧Web routeへの新規導線を閉じる。
5. 画面、専用client/state/view、画面専用テスト、不要になったrouteを段階的に削除する。

`temporarily_keep`は戦略上の残置ではなく、後継能力が未確認であることを表す移行状態とする。未確認を「不要」や「移管済み」に丸めない。

## Consequences

- Brainbase Webの画面数とUI回帰コストは継続的に減少する。
- 新機能はUIモックではなく、MCP/API契約、権限、失敗状態、監査証跡から設計する。
- Mac Companionは汎用管理画面にならず、人間の注意を扱う面へ集中する。
- Web UIを完成条件に含む既存Storyは、Core能力と提供面を分離して改訂する。
- 既存Web UIは一斉削除せず、機能消失を防ぐretirement gateを通して段階廃止する。
- UI実装を前提としたADR-015のProject-first Web UI判断は本ADRでsupersedeする。WorkflowのProject帰属、run台帳、human step、auditというドメイン判断は維持する。

## Rejected alternatives

- **Web UIを品質改善して継続する**: MCPと重複する二重実装コストを解消しないため却下する。
- **Mac Companionへ全管理機能を再実装する**: UI重複を別クライアントへ移すだけになるため却下する。
- **Web UIを即時一括削除する**: MCP権限、失敗状態、復旧経路が未確認の能力まで失うため却下する。
- **設定画面を一律に残す**: Agentから安全に扱える設定までGUIへ固定するため却下する。

## Verification

- 全production Web surfaceがretirement inventoryに存在し、所有者と移管先が明示されている。
- `move_to_mcp`の能力は、正常系だけでなく認証拒否、入力不正、依存先 unavailable、監査記録を検証する。
- `move_to_companion`の能力は、要介入項目だけを表示し、未確認や取得不能を0件へ丸めない。
- `keep_web`はブラウザ必須理由とMCP停止時の復旧責務を明記する。
- Web route削除前に、後継面のcurrent-HEAD evidenceとrollback手順を残す。
