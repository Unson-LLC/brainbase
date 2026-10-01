---
story_id: story-ux-20261001-01-world-model-empty-guidance
title: World Modelが空のとき、登録できる場所を判断できる
status: active
created_at: 2026-10-01
implementation_started: true
owner_repository: brainbase
depends_on: ["story-local-web-host-objectives-v1", "story-company-os-world-model-persistence-adoption-v1"]
external_dependencies: []
---

# World Modelが空のとき、登録できる場所を判断できる

## 利用者成果

初めて「目的と現状」を開いた利用者として、World Modelが空でも、表示専用の欄であること、利用者向けWeb/CLIに登録入口があるかどうか、登録機能を実装する場合の実在する経路を画面上で判断したい。存在しない画面やコマンドを案内されず、空の理由と次の選択肢を混同しない。

## 正本と現状

- 実装repoはOSS `Unson-LLC/brainbase` とする。Personal WebはこのrepoのローカルWebシェルが正本である。
- Personal WebのWorld Model HTTP routeは読み取り専用で、現行のWeb/CLIにはWorld Modelの利用者向け登録入口がない。
- 公開パッケージのWorld Model store API（`@unson/brainbase-mcp/world-model`）は、別の登録実装が使える既存の開発者向け経路である。Personal Webから直接呼び出したり、利用者向けの架空routeへ誘導したりしない。
- 利用者向けの登録入口をWebまたはCLIへ追加するには、読み取り専用契約・認証・保存境界を変えるため、別途アーキテクチャ判断が必要である。本Storyでは追加しない。

## 受入条件

- [ ] AC-01: 変数・モデル・観測・モデルの採用の全てが、正本で空であると確認できた場合、World Modelの区画見出しの近くに「登録方法」の案内を表示する。
- [ ] AC-02: 案内には、この欄が表示専用であること、現行OSSのWeb/CLIには登録入口がないこと、登録する実装では公開World Model APIを使うことを明記する。存在しないボタン、route、コマンド、リンクは表示しない。
- [ ] AC-03: いずれかの区画が未確認・失敗・不正形式・利用不可・一部未読の場合、空状態の案内を出さず、既存の「0件ではありません」境界と各区画の状態表示を維持する。
- [ ] AC-04: データが一つでもある場合、案内を出さず、既存の読み取り専用台帳を維持する。
- [ ] AC-05: 架空の空fixtureを使うUI回帰テストで、案内の可視テキストと、書込み操作がないことを確認する。

## 対象

- `ui/world-model-view.js` の空状態案内。
- `tests/ui/world-model-view.test.mjs` と、既存のLocal Web shell fixtureによる影響確認。
- 本Storyと対応する最小Spec。

## 対象外

- World Modelの保存route、Web/CLI登録画面、書込み権限、保存形式、Graph/SSOT境界の変更。
- 現行OSSにない利用者向け登録コマンドやリンクの新設。
- 常駐Webへの反映、別repoのMCP応答、既存のobjective編集。

## 検証と完了

既存の簡易DOMと架空の空応答fixtureでAC-01〜05を確認する。このPRは、空状態で実在する開発者向け経路と利用者向け入口がない事実を明示する部分改善であり、利用者が画面から登録できる状態までは完了しない。World Modelの読み書き境界に変更がないことを、既存のlocal-web-host契約とbuildで確認する。Graphifyの影響確認結果は、未確認を影響なしと扱わず、SpecとPR証跡に残す。
