# Brainbase：知識を判断に使い、Manaへの委任を成果につなげる

2026-09-17。VibeProに登録した13ストーリー。宣言時の状態と、実装・検証で確認した現在地を分けて示す。UI画像は方向性の合意であり、既存の実装能力を証明するものではない。

## 目標

人は目的・意味・責任・権限を確認し、Brainbaseが知識の保存・取得を支え、Codexが根拠を使い、Manaが許可された成果を作り検証する。

## ストーリーと順序

| ID末尾 | 利用者の成果 | 先行条件 |
|---|---|---|
| foundation-context | [既存の仕事の基盤を確認し、接続先を管理できる](stories/active/story-brainbase-outcome-foundation-context.md) | なし |
| knowledge-discovery | [使える知識と判断を探し、由来を確認できる](stories/active/story-brainbase-outcome-knowledge-discovery.md) | foundation-context |
| knowledge-capture | [文章や資料から知識と判断の登録案を作れる](stories/active/story-brainbase-outcome-knowledge-capture.md) | knowledge-discovery |
| knowledge-canonical-save | [確認した知識を正本と関係へ保存できる](stories/active/story-brainbase-outcome-knowledge-canonical-save.md) | knowledge-capture |
| knowledge-lifecycle | [判断の改訂と失効を履歴付きで管理できる](stories/active/story-brainbase-outcome-knowledge-lifecycle.md) | knowledge-canonical-save |
| knowledge-codex-use | [登録した判断をCodexの回答で根拠付きで使える](stories/active/story-brainbase-outcome-knowledge-codex-use.md) | knowledge-canonical-save, knowledge-lifecycle |
| knowledge-preview | [公開前に質問を試して判断の使われ方を確認できる](stories/active/story-brainbase-outcome-knowledge-preview.md) | knowledge-codex-use |
| mana-contract | [任せたい成果と完了条件を登録できる](stories/active/story-brainbase-outcome-mana-contract.md) | なし |
| mana-authority | [自動実行と承認が必要な操作を制御できる](stories/active/story-brainbase-outcome-mana-authority.md) | mana-contract |
| mana-triggers | [条件を満たした委任だけを有効化し停止できる](stories/active/story-brainbase-outcome-mana-triggers.md) | mana-authority, knowledge-discovery |
| mana-deliver-outcome | [委任した成果物を作り完了条件を検証できる](stories/active/story-brainbase-outcome-mana-deliver-outcome.md) | mana-triggers, knowledge-codex-use |
| mana-safe-test | [有効化前に外部へ送らず委任を試せる](stories/active/story-brainbase-outcome-mana-safe-test.md) | mana-deliver-outcome |
| mana-run-control | [実行結果を確認し承認と再開を行える](stories/active/story-brainbase-outcome-mana-run-control.md) | mana-deliver-outcome, mana-safe-test |

## 受け入れ条件の現在地

`一部完了` は記載した範囲だけがテスト済みで、Story全体の完了を意味しない。Graph・認証をテストダブルにした経路は本番readbackと区別する。

| Story | 現在地 | 確認済み | 未完了・未確認 |
|---|---|---|---|
| foundation-context | 宣言時の未着手 | なし | Story全AC |
| knowledge-discovery | 一部完了 | AC-1/2/3のバックエンド一覧・詳細、組織scope継承、権限内project限定、空/失敗/参照先のみの状態 | UI通し、本番Graph・認証readback |
| knowledge-capture | 一部完了 | AC-3の下書き保存・再開・破棄、revision競合、保存失敗後の入力保持契約 | AC-1のAI提案、AC-2の原文比較・既存候補選択、資料入力の実アダプター |
| knowledge-canonical-save | 一部完了 | 判断のGraph保存、RACI domain認可、部分失敗後の同一key再開、ID・版・本文hashのreadback | 文書本文の正本writer、本番Graph・認証readback、UI全差分確認 |
| knowledge-lifecycle | 一部完了 | AC-1の本文・scope・責任者・有効期間改訂、CAS競合、変更理由・前後snapshot履歴、廃止/関連解除 | AC-2の正式なsupersedes操作と発効時失効、AC-3の共有利用先影響表示、本番DB E2E |
| knowledge-codex-use | 一部完了 | 版固定のread-only MCP取得契約、ID・版・取得receipt、権限外project除外 | AC-4の実MCP→本番Graph通し、文書retriever、本番provider E2E |
| knowledge-preview | 一部完了 | 隔離previewのAPI境界と下書き版識別 | 実検索・回答provider、採用/除外根拠の実readback、UI通し |
| mana-contract | 宣言時の未着手 | なし | Story全AC |
| mana-authority | 宣言時の未着手 | なし | Story全AC |
| mana-triggers | 宣言時の未着手 | なし | Story全AC |
| mana-deliver-outcome | 宣言時の未着手 | なし | Story全AC |
| mana-safe-test | 宣言時の未着手 | なし | Story全AC |
| mana-run-control | 宣言時の未着手 | なし | Story全AC |

## 境界と既存機能

- このリポジトリのVibeProを横断計画の窓口とし、同じストーリーIDを実装先でも参照する。UIはbrainbase-organization、正本・ontology・MCPはBrainbase、委任実行はmana-runtimeが担当する。実装前に各repoのSpecでAPI境界を確定する。
- 基盤の参照先CRUDは既存実装を再利用し、既存データの表示と状態の意味、知識・委任への導線を整える。登録済みと利用可能を同一にしない。
- `story-brainbase-mcp-core-ontology` は型と拡張の既存計画。新しい保存ストーリーはその検証機構を使う利用者の登録経路であり、ontology再設計を重複して開始しない。
- `story-brainbase-hdq-approved-candidate-execution-v0` 等の既存承認機構は調査・再利用する。Manaのタスク書き込みのauto/approval/denyを、一般的な成果物作成や送信権限と解釈しない。
- 現行CanonicalTaskに委任の完了条件・トリガー・保存先契約はない。既存の限定的な定期実行を再利用し、文書追加トリガー・隔離試験・成果物アダプターは追加開発として扱う。
- Graphは構造化事実・判断・関係の正本。文書本文の保存先はknowledge resolverの分類に従う。参照先だけで本文取得済みとはしない。
- 利用者の担当者名、納期、予算は推測して登録しない。各ストーリーの開始時に必要な条件だけ具体化する。

## UI参照

実際に参照したMobbin例：

- [Intercomの文書編集](https://mobbin.com/screens/0554eb7f-7216-484e-9904-1b216f672b0f)
- [Lightfieldの知識管理](https://mobbin.com/screens/495207ea-b29f-4070-95ac-bb593d9ff263)
- [Airtableの自動化](https://mobbin.com/screens/4e7e38c9-9513-4f9a-83cc-76e1bf020f48)
- [incident.ioの試験導線](https://mobbin.com/screens/9d6e14bc-7ede-4887-8dda-75f32580b417)

## 設計根拠と完了範囲

- Graphで取得した `decision_intent_to_outcome_north_star`：本人にしか決められない目的・価値・責任・権限以外の文脈取得・実行・検証をAIが担う。
- `config/ontology/brainbase-ontology.v1.json`、`server/services/ontology-kernel.js`、`server/services/info-ssot-service.js`、`server/services/knowledge-resolution-service.js` を技術境界の根拠とした。
- Manaのtask-runtime-core、write-broker、cloud-runtimeの契約を確認した。各ストーリーは不足する利用者経路を表し、実装・本番反映・実行試験は今回の完了範囲に含まない。

## VibePro登録の保存

ローカルのVibePro CLI `story add` で13件を登録し、`story list` と各traceabilityの `declared_not_started` を再取得した。既存ストーリーと選択中IDは維持した。`.vibepro` はこのrepoではGit対象外のため、共有・再登録用の宣言を [JSON](brainbase-outcome-stories.json) に保存する。別環境では同じIDの存在を確認してから `vibepro story add --id <story_id> --title <title>` で不足分だけ登録する。Graphへの同期・公開は今回実施していない。
