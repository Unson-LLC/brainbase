# Brainbase Surface Responsibility Matrix

Status: accepted

Decision: `ADR-017-agent-first-product-surface`

## Purpose

Brainbaseの能力を「どの画面に置くか」ではなく、「どの提供面が責任を持つか」で判断する。新機能と既存機能の両方に適用する。

## Responsibility matrix

| Surface | Primary responsibility | Must contain | Must not become |
|---|---|---|---|
| Brainbase Core | AI組織のControl PlaneとSSOT | Graph、API、MCP、Workflow/Task/Run台帳、認証・認可、connector、audit、learning | UI都合でドメイン契約が分岐する場所 |
| Codex / Claude Code | Brainbaseの標準操作面 | 検索、登録、更新、実行、確認、診断、管理、復旧手順の実行 | 失敗を推測で補う非監査操作 |
| Mac Companion | 人間の注意と判断の即応面 | 通知、承認、blocked/failed/waiting_human/unconfirmed/no_data、修正、feedback | 全台帳を閲覧・編集する汎用管理画面 |
| Brainbase Web | ブラウザ必須の最小管理面 | login、OAuth/consent、bootstrap、権限付与、pairing、break-glass recovery | 日常業務、一覧巡回、MCPで可能な設定の重複UI |
| No UI | 自動処理 | schedule、reconciliation、retry、delivery、機械判定可能な処理 | 人間が定期巡回しないと成立しない運用 |

## Placement decision

新しい能力は以下の順で配置する。

1. 安全なMCP toolとして実行できるか。できるならCodex/Claude Codeを標準面とする。
2. 人間なしで閉じられるか。閉じられるならUIを作らず自動化する。
3. 人間の注意・承認・修正が必要か。必要ならMac Companionへ要介入projectionを出す。
4. OAuth、本人確認、接続同意、端末ペアリングなどブラウザが不可欠か。不可欠な場合だけWebへ置く。
5. MCP自体が停止した際の復旧に必要か。必要なら依存を最小化したbreak-glass Web surfaceを検討する。

## Capability parity gate

「Codex/Claude Codeから呼べる」は、tool名が存在するだけでは完了にならない。Web機能を廃止する前に、後継面が次を満たす必要がある。

- read/write/executeの必要操作をすべて表現できる。
- human actor、service actor、project scopeの認証・認可を保つ。
- blocked、unconfirmed、no_data、依存先 unavailableを成功や0件へ丸めない。
- destructive、external、paid、production操作に確認境界がある。
- 操作結果と監査証跡を再確認できる。
- MCPの応答だけで復旧できない場合、正規runbookまたは最小Web復旧面へ到達できる。

## Agent Run Inbox placement

Agent Run Inboxは1つのデータ能力を複数の責務へ分ける。

| Responsibility | Owner |
|---|---|
| receipt contract、ingest、冪等保存、priority、latest collapse、audit | Brainbase Core |
| 全件・履歴・診断・filter・再確認 | Codex / Claude Code via MCP |
| blocked、failed、waiting_human、unconfirmed、no_dataの要介入projection | Mac Companion |
| current Workflow Mission Control Web section | transition-only。MCP/Companion移管後に廃止 |

成功runの常時通知はMac Companionの責務にしない。取得不能時は最後に確認済みの状態を維持し、「0件」と表示しない。

## Web keep boundary

Webに残す候補は次に限定する。

- login/logoutとinteractive authentication
- OAuth provider consent/callback
- 初回bootstrapとworkspace/orgへの参加
- actor、project、deviceへの権限付与
- Mac Companion/device pairing
- MCPまたはCompanionが利用不能な場合のbreak-glass診断・復旧

これらも、ブラウザ必須理由がなくなった時点で再評価する。
