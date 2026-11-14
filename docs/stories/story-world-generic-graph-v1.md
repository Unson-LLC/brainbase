---
story_id: story-world-generic-graph-v1
title: 世界を、どのGraphでも同じ規則で描き、分類と状態の言葉は持ち主が与える
status: in_progress
created_at: 2026-10-04
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# 世界を、どのGraphでも同じ規則で描き、分類と状態の言葉は持ち主が与える

## 利用者成果

Brainbaseを使う人なら誰でも、自分のGraphのプロジェクトが「世界」に都市として立つ。分類や状態の言葉が自分の組織のものと違っても、都市が消えたり誤った見た目になったりしない。自分の組織の言葉で表示したいときは、語彙ファイルを1つ渡せばよい。

## 背景

世界（台帳 P17、2026-10-04採用）は、雲孫の組織Graphの台帳に固有な項目（`payload.kind` の4分類、`project_code`、`repository_roots`、状態の語彙）を直接読み、組織Graphにしか接続していなかった。手元のGraphだけの人には都市が1つも立たず、4分類に無いプロジェクト（例：分類なし、`other`）は描かれなかった。

佐藤さんは「分類の語彙は組織Graphのオントロジーで定義する」方向を選んだ（2026-10-04）。ただし組織Graphのオントロジーは、現状ではサーバー全体で1つのmanifestで、型ごとの値の語彙を書く場所が無い（brainbase-unson `config/ontology/releases/1.3.0.json`、`server/services/ontology-kernel.js`）。このStoryは、語彙がどこから来ても描けるように、世界の側を語彙の出どころから切り離す。オントロジーへの語彙の追加は別Story・別の承認とする。

## 受入条件

- [x] AC-01: 世界の事業は、ほかの画面と同じGraphから読む。ホストが組織Graphを読んでいる（C1）ときはそれを、いないときは手元のGraphを読む。読めないときは理由つきの状態（`not_initialized`・`migration_required`・`unavailable`）で返し、事業0件にしない。
- [x] AC-02: 都市は親を持たないプロジェクト、区画は `metadata.parent_project_id` で別のプロジェクトを指すプロジェクト（何段でも最上位の都市にまとめる）。宣言した親（`metadata.parent_project_code`）がGraphに無いプロジェクトは描かずに件数で示す。`validTo` を過ぎたものは件数で示す。
- [x] AC-03: C1 は、組織Graphが述べていることだけからプロジェクトの `code`・親（そのスコープのカタログのプロジェクト）・リポジトリ（`repository_roots`）を書き出す。カタログのプロジェクトは、自身の `code`（無ければ id）がスコープの `project_code` と一致するもの。
- [x] AC-04: 分類と状態の言葉は、ホストの語彙（`web:serve --world-vocabulary <file>`）から与える。語彙に無い分類はその値のまま、分類の無いものは「分類なし」として描く。状態は共通の言葉（進行中・保守・完了・終了・保管・構想）に語彙を重ね、語彙に無い状態は値のまま「進行中」の見た目にする。
- [x] AC-05: 語彙ファイルの建物（`tower`・`hall`・`dome`・`office`）・段階（`active`・`maintenance`・`finished`・`concept`）・色（`#rrggbb`）が不正なら起動を止め、黙って無視しない。
- [x] AC-06: 画面は語彙だけで描き、特定の組織の分類名・色・状態名を持たない。

## 対象外

組織Graphのオントロジーに型ごとの値の語彙を足すこと（ontology release の提案・承認・公開）、判断を事業に置く規則（`ui/world/world-placement.js`）の変更。

## 検証

- `tests/world-extension.test.ts`：都市と区画（多段）、親の無い区画、期限切れの件数、語彙の順序と未知の値、語彙ファイルの検査、組織Graph・手元Graph・読めないときの状態。
- `tests/organization-graph-web.test.ts`：C1 が code・親・リポジトリを書き出すこと（id がコードのカタログを含む）。
- 実データ：組織Graphで、変更前と同じ事業17件・案件15件・コード・リポジトリに、変更前は描かれなかった2件（分類なし・`other`）が加わること。手元Graphだけで都市が立つこと。
