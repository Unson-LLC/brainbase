---
spec_id: ux-20261001-01-world-model-empty-guidance
story_id: story-ux-20261001-01-world-model-empty-guidance
status: draft
spec_maturity: implementation_ready
owner_repository: brainbase
---

# World Model空状態から最初の登録を行うSpec

## 状態判定と表示

- `variables` と `observations` がそれぞれ `state: 'empty'`（`absence_confirmed: true`、未読0件）のとき、`bb-wm-registration-guidance` に「最初の登録」フォームを表示する。
- `unknown`、`error`、`invalid`、`unavailable`、`partial`、未読ありは空とみなさず、既存の「0件ではありません」境界・再試行・利用不可表示を維持する。
- `models` と `adoptions` はフォームの表示条件ではないが、初回フォームでは登録しない。全4区画が空の場合も、利用者には変数と最初の観測値を登録できること、モデル等は別手順であることを示す。

## フォーム契約

フォームは次の利用者入力を受け取る。未入力の必須値、数値以外の数値欄、許可されない値の種類・集計方法は送信しない。

| 入力 | API field | 契約 |
| --- | --- | --- |
| 何を記録するか | `meaning` | 空でない文字列 |
| 対象 | `subject` | 空でない文字列 |
| 値の種類 | `valueKind` | `number` / `boolean` / `string` / `state` |
| 単位 | `unit` | `number` のとき必須。それ以外は任意 |
| 集計方法 | `aggregation` | `none` / `sum` / `average` / `count` / `min` / `max` / `last` / `custom` |
| 記録の単位 | `granularity` | 空でない文字列 |
| 測り方 | `measurementMethod` | 空でない文字列 |
| 最初の値 | observation `value` | 種類に応じた有限数、真偽値、文字列 |

## POST API契約

### `POST /api/world-model/variables`

本文は `meaning`、`subject`、`valueKind`、任意の `unit`、`aggregation`、`granularity`、`measurementMethod` のみ受け取る。`id`、`revision`、`type`、`adoptionState`、`authorizedUses`、`acl`、`storage`、`provenance`、`scope`、`ownerId` などのauthority fieldは本文で指定できず、400を返す。

local Web hostは、Graph ownerをprincipalとして次を構成する。

- idはhostが生成、type=`variable`、revision=`1`。
- adoptionState=`draft`、authorizedUsesは `draft`／`judgment`／`evaluation`。
- ACLは owner private、reader/writerは空。
- storage=`ontology`、provenanceは `brainbase-local-web` の観測出典、scopeはownerの有効範囲。

201応答は、保存後readbackの `reference`（id/type/revision）とdigestを返す。

### `POST /api/world-model/observations`

本文は `variableRef`（id/type=`variable`/revision）と `value` のみ受け取る。id、subjectId、occurredAt、recordedAt、period、sourceRefはhostがownerと `context.now()` から構成する。201応答は `WorldModelStore.saveObservation` のreadback observationを返す。対象変数がない、ACLが不正、値の型が合わない場合は既存WorldModelStoreのエラーコードで返す。

GETの既存4 routeは保存後に読み直し、変数と観測値を台帳に表示する。変数保存後の観測値保存は同一トランザクションではないため、後段失敗時は「変数は登録されたが観測値は保存できなかった」と表示する。

## 信頼境界

既存のlocal Web hostの同一Origin、loopback、launch token検査を全POSTに適用する。hostはGraph owner以外のprincipalを採用しない。フォームとAPIはモデル、adoption、correctionを提供しない。

## 非変更契約

- World Modelの既存GET応答、正規化、部分未読、承認未確認、台帳、右レールを変更しない。
- 常駐Web、別repoのMCP、Graphのrelation・SSOT形式は変更しない。
- authority fieldや実在しないroute／CLIを画面から案内しない。

## 回帰テスト

- `tests/ui/world-model-view.test.mjs`: 架空の全空fixtureで、フォームが表示され、架空入力がvariables→observationsの2 POSTになり、token header・本文のauthority欠落・GET後readbackを確認する。非empty／unknown／partial fixtureではフォームを表示しない。
- `tests/ui/local-web-shell.test.mjs`: Graph v2の初回目的画面にフォームと境界文言が現れること、Graph v1の移行ゲートではWorld Modelを書き込まないことを確認する。
- `tests/local-web-host.test.ts`: 実storeを使い、variables→observationsのPOSTとGET readback、host生成ID／owner／時刻／出典、authority field拒否、models等の405を確認する。

## 影響確認

Graphifyを本Story／Spec／実装／テストに対して再実行し、traceと診断をPRに添付する。今回のPOST接続は既存storeを再利用するが、GET専用から書込み可能へ契約を広げるため、アーキテクチャ判断待ちとしてPR後に停止する。

## ローカルWeb回帰受入条件（W-20261002-UXE2E）

- 架空の一時`data_dir`と`journalRoot`で`createLocalWebHost`をloopback起動し、HTTPテストから`#objectives`相当のWorld Model応答を読む。
- GraphとWorld Modelが確認済みの空状態なら「最初の登録」と案内を表示する。既存の変数・観測値がある状態では既存内容を表示し、初回登録の入口を表示しない。
- GraphまたはWorld Modelを読み取れない状態では、読み取れない理由と次の操作を表示し、「0件」や初回登録として表示しない。
- 変数・観測値のPOSTは、同一Originと起動トークンの両方が必要で、欠落・不一致の各リクエストを拒否し、データを作成しない。
- `tests/local-web-host.test.ts`でHTTPと一時data_dir/journalを、`tests/ui/local-web-shell.test.mjs`で画面表示を確認する。fixtureはテスト実行中に作成し、実データ・常駐Web・利用者のjournalを参照しない。
