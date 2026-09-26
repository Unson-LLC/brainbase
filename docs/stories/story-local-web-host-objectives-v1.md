---
story_id: story-local-web-host-objectives-v1
title: ローカルWebの1つのホストで、今日と「目的と現状」を行き来できる
status: active
created_at: 2026-09-26
implementation_started: true
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-web-v1", "story-company-os-objective-editor-v1", "story-company-os-world-model-persistence-adoption-v1"]
external_dependencies: []
---

# ローカルWebの1つのホストで、今日と「目的と現状」を行き来できる

## 利用者成果

単独所有者として、`brainbase web:serve`で開いたブラウザで、判断の見返し（今日）と「目的と現状」を上のナビで行き来したい。「目的と現状」では、いま何を目指しているか（目的）を版つきで直し、現状をどう理解しているか（World Model）を、記録された観測と仮説を含む見方に分けて見たい。どのデータを読んでいるか（データの場所、Graphの形式）を、各画面の上で確かめたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 情報契約: brainbase-project `docs/architecture/oss-personal-web-v1-remaining-screens-contract.md`（§1、§2、§5、§9の1・2・3・7。単位W1とW2）
- 対象: ローカルWebホスト（`src/local-web-host.ts`、`brainbase web:serve`と別名`review:serve`）、共通の守り（`src/local-web-security.ts`）、共通UI部品（`ui/local-web-shell`、`ui/world-model-view`、`ui/objective-editor-http-port`、`ui/brainbase-tokens.css`、`ui/objective-editor`の表示の追加）

組織、メンバー、役割、承認、外部サービスを必須にしない。プロジェクトと関係者、情報と関係（Graphの画面）は別のStoryで加える。

## 受入条件

- [ ] AC-01: `brainbase web:serve`は`127.0.0.1`だけで待ち受け（既定のポート31080）、`review:serve`は同じホストを開く別名とする。上のナビには、この時点で存在する「今日」と「目的と現状」だけを出す。
- [ ] AC-02: ホストは、Hostがループバックの名前と待ち受け中のポートの組でない要求を、画面・部品・APIのすべてで最初に断る。GET以外の要求には、起動ごとのトークンと同一オリジンを要求する。画面には厳しいCSPを付け、配信する部品を決めたファイルに限る。既存の見返しホストの振る舞いは変えない。
- [ ] AC-03: 目的は、既存のFoundationの経路で一覧・作成・読み取り・更新・readinessを扱う。利用者はGraphの所有者ID（無ければ`self`）とし、ブラウザからは受け取らない。権限・範囲・保存先・由来・用途の欄はホストが決め、送られた場合は断る。更新は版を指定し、古い版からの保存は今の版を示して断り、入力を残す。保存後は同じIDの新しい版を読み戻して確かめる。
- [ ] AC-04: 目的に関係する制約は、その版に対する`applies_to`だけを表示し、画面から変更しない。Storyのタブは出さない。
- [ ] AC-05: World Modelは読み取りだけで、変数とモデル（何を表すか、認識の状態、版）と、観測（対象、値、発生時点、期間、記録時点、出典、訂正の関係）を分けて表示する。承認を確かめる仕組みがない環境では、承認済みの採用があれば「モデルの採用」の欄だけ表示できないと示し、ほかの欄は使える。
- [ ] AC-06: 各画面の上に、データの場所、Graphの形式、組織のGraphを読んでいないことを出す。Graph v1のときは「目的と現状」に「Graphの移行が必要です」と移行のコマンドを出し、目的とWorld Modelを読みにいかない。ホストは自動で移行も、データの場所の作成もしない。
- [ ] AC-07: 一覧が空と表示するのは、正本に記録が無いと確認できたときだけとする。読み取りの失敗、未確認、一部の記録が読めない場合は0件とせず、読めた記録と読めない件数・理由を分けて示す。
- [ ] AC-08: 新しい部品と外枠は、共通の見た目の定義（`ui/brainbase-tokens.css`の`--bb-*`）だけで色・文字・余白を決める。

## 対象外

World Modelの書き込み（観測の追加・訂正、モデルの採用）。目的に関係する制約の置き換え。組織のGraph（C1）への接続。プロジェクトと関係者・情報と関係の画面。既存部品の見た目の定義への移行。

## 検証と完了

ホストの守り・目的の読み書き・World Model・Graphの形式は一時ディレクトリの実ファイルで、部品は簡易DOMで確かめる。合成したGraph v2とv1のデータで、実ブラウザ（幅375pxを含む）で今日から目的と現状へ移り、目的の作成・更新・競合と、移行が必要な表示を確かめる。
