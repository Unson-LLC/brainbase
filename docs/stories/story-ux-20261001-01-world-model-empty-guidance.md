---
story_id: story-ux-20261001-01-world-model-empty-guidance
title: World Modelが空のとき、最初の記録を登録できる
status: active
created_at: 2026-10-01
implementation_started: true
owner_repository: brainbase
depends_on: ["story-local-web-host-objectives-v1", "story-company-os-world-model-persistence-adoption-v1"]
external_dependencies: []
---

# World Modelが空のとき、最初の記録を登録できる

## 利用者成果

初めて「目的と現状」を開いた利用者として、World Modelが空でも、何を記録するかと最初の値を画面から登録したい。登録後は、この手元のWebホストが保存した変数と観測値を同じ画面で読み直し、登録できた事実を確かめたい。モデルの作成・採用や既存観測の訂正を、初回登録と混同しない。

## 正本と登録経路

- 実装repoはOSS `Unson-LLC/brainbase` とする。Personal Webはこのrepoのlocal Web shellが正本である。
- 正本の保存実装は `createWorldModelStore` と `FoundationRevisionStore`（変数）および World Model sidecar（観測値）である。既存の開発者向けstore APIを、local Web hostが所有者を確定した入力に接続する。
- Webの書込みは、loopback・同一Origin・launch tokenの既存境界を通し、リクエスト本文からowner、ACL、時刻、sourceを受け取らない。hostがGraph ownerと現在時刻から決める。
- 初回登録の範囲は変数1件と最初の観測値1件である。モデル、モデル採用、既存観測の訂正は別の確認・権限契約が必要なため、このStoryでは入口を作らない。

## 受入条件

- [ ] AC-01: 変数と観測値がともに正本で空であると確認できた場合、World Modelの見出し近くに、利用者が操作できる「最初の登録」フォームを表示する。未確認・失敗・利用不可・一部未読は空として扱わない。
- [ ] AC-02: フォームは、意味、対象、値の種類、必要な単位、集計方法、記録の単位、測り方、最初の値を入力できる。値の種類に応じて数値・真偽値・文字／状態を保存する。
- [ ] AC-03: 送信は正本の `/api/world-model/variables` と `/api/world-model/observations` を使い、local Web hostがowner・ACL・記録日時・期間・出典を決める。クライアントから authority field を受け取らず、入力エラーを記録せずに返す。
- [ ] AC-04: 変数の保存後に最初の観測値を保存し、両方の保存結果をGETで読み直して台帳に表示する。後段の観測値保存だけが失敗した場合は、変数だけ保存されたことと観測値が未保存であることを画面に明示する。
- [ ] AC-05: モデル、モデル採用、既存観測の訂正を初回フォームの登録対象や利用可能な操作として表示しない。既存の認識状態・不確かさ・訂正の表示契約を維持する。
- [ ] AC-06: 架空の空fixtureでフォームの可視テキスト、2つのPOST、GET後のreadbackを確認する。Graph owner由来のauthorityを外部から上書きできないことをlocal-web-host回帰テストで確認する。

## 対象

- `src/local-web-host.ts` の初回登録POST route（variables／observations）と入力境界。
- `ui/world-model-view.js`、`ui/world-model-view.css`、`ui/local-web-shell.js` のフォーム、token、readback。
- `tests/local-web-host.test.ts`、`tests/ui/world-model-view.test.mjs`、`tests/ui/local-web-shell.test.mjs` の架空fixture回帰テスト。
- 本Storyと対応する最小Spec、およびGraphify影響確認。

## 対象外

- モデル作成、モデル採用、既存観測の訂正、Graphへの新しいrelation、別repoのMCP応答。
- resident Webの再起動、常駐環境への反映、checkpointの更新。

## アーキテクチャ境界と完了

利用者向けの登録導線を実現するため、既存のGET専用World Model routeにPOST routeを追加し、local Web hostの信頼境界からWorldModelStoreの保存・readbackへ接続する。これは案内文だけのUI修正ではなく、認証・保存境界に触れるためアーキテクチャ変更候補である。PRとCI、レビュー、回帰テストまで実施するが、判断台帳での承認が必要な変更としてマージせず親へ返す。マージ判断前に、変数保存後の観測保存失敗が非原子的であることを未解決として記録する。

## 検証

focused UI test、local Web host test、Graphify／Story trace、1回レビューを実施する。CIの結果と、利用者ペルソナでのInspector再確認は親の反映後に記録する。
