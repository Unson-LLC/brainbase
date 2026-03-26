# Brainbase 基本構成

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: Brainbase の基本構成と正本分担
- 親文書: [UnsonOS ランタイム UI フレーム](../frames/unson-os-runtime-ui-frame.md)
- 派生元: なし
- 関連文書: [docs ガイド](../README.md), [UnsonOS 文書トレーサビリティ](./unson-os-document-traceability.md), [現場責任者コンソール](./unson-os-lead-control-console.md)
- 置換: なし

## 目的

Brainbase で「何が正本で、どこに書き戻され、何を同期するのか」を一枚で確認できるようにする。

この文書では次を固定する。

- Brainbase の基本構成
- `wiki` / `skills` / `docs` / `DB` の役割分担
- sync の意味
- フィードバックループがどこへ戻るか

## 基本原則

### 1. UI は投影であり、正本ではない

- ブラウザ UI は表示・操作の入口
- データの正本は別にある
- UI から見えているものをそのまま正本だと思わない

### 2. 正本は用途ごとに分かれる

- `wiki` はサーバ側 DB が正本
- `skills` は repo 内ファイルが正本
- `docs/` は設計・仕様・説明の正本
- 実行状態や派生ビューは正本ではない

### 3. sync は「正本を揃えるための搬送」であって、正本の置き場変更ではない

- `wiki pull/sync/push` は DB 正本とローカル作業コピーを揃える
- sync したから正本がローカルに移るわけではない

## 正本一覧

| 領域 | 正本 | 更新主体 | 補足 |
| --- | --- | --- | --- |
| Wiki 本文 | サーバ DB `wiki_pages` | API / CLI / learning | ローカル markdown は同期コピー |
| Wiki 権限 | サーバ DB `wiki_pages.role_min/sensitivity/project_id` | server | path だけで権限を表さない |
| Skills | repo の `.claude/skills/*/SKILL.md` | Git で更新 | 実行手順・発火条件の正本 |
| docs | repo の `docs/**/*.md` | Git で更新 | 設計・仕様・説明の正本 |
| セッション状態 | server memory + `state.json` | server | UI は投影 |

## wiki と skills の違い

### wiki

- 置くもの:
  - 定義
  - 原則
  - 判断基準
  - 仕様
  - ストーリー
  - 決定
- 正本:
  - サーバ DB
- 更新方法:
  - `/api/wiki/page`
  - `brainbase wiki push`
  - learning の wiki 昇格

### skills

- 置くもの:
  - 発火条件
  - 実行手順
  - チェックリスト
  - failure handling
  - guardrails
- 正本:
  - repo の `.claude/skills/*/SKILL.md`
- 更新方法:
  - Git 管理で更新
  - learning の skill 昇格

### 判断ルール

- Why / policy / definition は `wiki`
- When / how / checklist / recovery は `skills`

## sync の意味

### `brainbase wiki pull`

- サーバ DB の wiki 正本をローカルへ持ってくる
- ローカルを最新化するための操作

### `brainbase wiki push`

- ローカルで編集した wiki markdown をサーバ DB へ反映する
- 反映先の正本はサーバ DB のまま

### `brainbase wiki sync`

- pull と push を差分付きで双方向に行う
- どちらを正本にするかを切り替えるコマンドではない

## フィードバックループ

Brainbase の学習ループは二本柱で戻す。

1. `review` / `explicit_learn` から episode を作る
2. reusable な知識を `wiki candidate` と `skill candidate` に分ける
3. wiki は canonical path に昇格する
4. skills は既存 skill patch か新規 skill に昇格する

### wiki への昇格

- 対象:
  - 定義
  - ルール
  - 判断基準
  - 仕様差分
  - ストーリー差分
- 書き戻り先:
  - サーバ DB の `wiki_pages`
- 注意:
  - repo の `docs/` を直接更新するループではない
  - 各メンバーの手元へは `wiki pull/sync` で配る

### skills への昇格

- 対象:
  - 手順
  - チェックリスト
  - recovery
  - trigger
- 書き戻り先:
  - repo の `.claude/skills/*/SKILL.md`
- 注意:
  - skills は Git 管理の正本
  - wiki にある原則を上書きしてはいけない

## canonical wiki path の考え方

wiki path は「文書種別」を表す。所属プロジェクトは DB の `project_id` で管理する。

- `architecture/`
- `specs/`
- `stories/`
- `decisions/`
- `spikes/`

つまり、

- path: 文書の種類
- `project_id`: どのプロジェクトに属するか

で分離する。

## よくある誤解

### ローカルに `docs/*.md` があるから、それが wiki 正本

違う。`docs/` は repo の設計文書群で、wiki 本文の正本ではない。

### `wiki sync` をしたからローカルが正本

違う。sync はサーバ DB 正本とローカルコピーを揃えるだけ。

### skills もサーバ側へ同期される

違う。skills の正本は repo。

### UI に見えているものが正本

違う。UI は投影。

## 迷ったときの確認順

1. まず「これは定義か、手順か」を分ける
2. 定義なら wiki、手順なら skills を疑う
3. wiki の場合はサーバ DB 正本を前提に考える
4. repo の設計説明が必要なら `docs/` を見る
5. UI 表示を正本扱いしない
