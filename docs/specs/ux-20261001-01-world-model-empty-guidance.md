---
spec_id: ux-20261001-01-world-model-empty-guidance
story_id: story-ux-20261001-01-world-model-empty-guidance
status: draft
spec_maturity: implementation_ready
owner_repository: brainbase
---

# World Model空状態の登録方法案内 Spec

## 状態判定

`WORLD_MODEL_SECTIONS`（`variables`、`models`、`observations`、`adoptions`）の全区画が `state: 'empty'` のときだけ、World Model全体が空であると扱う。`empty` は既存の `absence_confirmed: true` による正本確認を通過した状態であり、`unknown`、`error`、`invalid`、`unavailable`、`partial` は空とみなさない。

## 表示契約

- `現状と見通し` の区画見出し直後に、既存の `workspaceNotice` を使った `bb-wm-registration-guidance` を追加する。
- noticeの短いラベルは `登録方法` とする。
- 本文は次の事実を一つの案内として表示する。
  - この欄は表示専用である。
  - 利用者向けの現行OSSのWeb/CLIにはWorld Modelの登録入口がなく、この画面から登録できない。
  - 登録機能を実装する場合は公開パッケージ `@unson/brainbase-mcp/world-model` の `createWorldModelStore` を使い、変数・モデル・観測・モデルの採用を保存する。これは開発者向けの既存APIであり、利用者向けの操作手順ではない。
- 本文はボタン、リンク、入力欄を持たない。存在しないWeb/CLI routeやコマンドを推測して表示しない。

## 非変更契約

- World Modelのfetcher、GET route、状態正規化、再試行、台帳、右レール、保存経路を変更しない。
- データが空でない状態、空が確認できない状態、全区画が利用不可の状態では既存表示を維持する。
- 新しいCSSトークンや画面外の設定を追加しない。既存noticeの見た目を利用する。

## 未解決の境界

利用者向けの登録入口を追加するには、現在のGET専用World Model route、認証、保存・readback境界を変更する必要がある。この変更はUI文言の範囲を越えるため、本Specではアーキテクチャ判断待ちとして扱い、PRの受入条件に含めない。

## 回帰テスト

`tests/ui/world-model-view.test.mjs` に、変数・モデル・観測・採用が空である架空fixtureを追加する。fixtureをmountした結果について、`登録方法` とWeb/CLI入口がない旨の文言が見えること、`bb-wm-registration-guidance` が一つであること、`BUTTON` と `A` が存在しないことを確認する。既存の未確認・失敗・部分未読fixtureでは空案内が出ないことも確認する。

## 影響確認

対象は `ui/world-model-view.js` とそのUI fixtureであり、Webの読み取り専用境界・公開store API・保存形式は変更しない。Graphifyの実行結果（run `2026-10-01T131101Z`、4185 nodes／11048 edges、extracted 9497／inferred 1551／ambiguous 0、requirement consistency 5 invariants／0 scenario gaps／0 contradictions）を影響確認の証跡とする。診断の一般的な `VP-FLOW-000`、`VP-NET-001`、`VP-ARCH-001`、`VP-STATIC-002` はUIルート未走査・既存の別API route・既存混在責務・一般的な静的検出であり、本Storyの範囲を変更しない。未確認を影響なしとは扱わず、利用者向け登録入口がない点は未解決として残す。
