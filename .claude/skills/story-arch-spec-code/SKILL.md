---
name: story-arch-spec-code
description: "Enforce the story-driven pipeline with a TDD gate: Story -> Architecture -> Spec -> TDD (Red/Green/Refactor) -> Code. Use when deriving architecture/spec/code from stories, designing AI-first SSOT, or enforcing order of artifacts."
---

# Story -> Architecture -> Spec -> Code

目的: ストーリー駆動を破らず、**Story -> Architecture -> Spec -> TDD -> Code**の順で確実に落とす。

## 使い方（最短）
1) **Story** を更新・追加（仕様/実装は書かない）
2) **Architecture** に落とす（境界/責務/データ層のみ）
3) **Spec** を作る（API/スキーマ/フロー/受入条件）
4) **TDD** で実装（t_wada式：Red -> Green -> Refactor）
5) **Code** を確定（Spec準拠、TDD通過が前提）

## 入力として確認すべきこと
- 対象プロジェクト（未指定なら brainbase）
- 変更の主題（story ID or 課題の一文）
- アーキ前提（例: SSOT = AI-first, B: Postgres中核）

## 出力ルール（順序厳守）
- **Story**: ストーリー文書にのみ書く。仕様/実装は書かない。
- **Architecture**: 概念レイヤー・境界・データ流のみ。具体APIやテーブルは書かない。
- **Spec**: 実装に必要な詳細を明文化。ここから先に進めない。
- **TDD**: `tdd-workflow` に準拠（Red/Green/Refactorを通過）。
- **Code**: Specに沿って実装。TDD未完なら止める。

## docs フォルダ構成ルール

Story駆動開発で `docs/` を使う場合は、次の役割分担を正本とする。

- `docs/frames/`
  - 全体の世界観、前提、設計思想、語彙、判断軸を固定する
  - 複数ストーリーの親になる文書を置く
- `docs/stories/`
  - ユーザーストーリー、通しシナリオ、受け入れ条件を置く
  - 「誰が・何を・なぜ」を書く
  - 仕様や実装詳細は書かない
- `docs/architecture/`
  - レイヤー、境界、投影、責務、正本、制御面を置く
  - UI 名があってもよいが、 backend 側の責務と混同しない
  - 具体 API / DB schema / 実装コードは書かない
- `docs/specs/`
  - object、event、command、state、API、schema、受け入れ条件の接続を書く
  - 実装に必要な詳細をここで初めて確定する

## ファイル構成と命名ルール

- 1つの主題につき、基本は次の順で文書を作る
  1. `docs/frames/<topic>.md` （必要な場合のみ）
  2. `docs/stories/<topic>-story.md`
  3. `docs/architecture/<topic>.md`
  4. `docs/specs/<topic>.md`
- 既存のファイル名を変えるより、関連文書を追加してリンクでつなぐ方を優先する
- ファイル名は `kebab-case`
- 表示名は日本語でよいが、ファイル名は英語ベースの識別子でそろえる
- 同じ主題で複数文書に分かれる場合は、接尾辞で役割を分ける
  - 例: `-story`, `-scenario`, `-ui-concept`, `-runtime-architecture`, `-adapter-spike`
- 同じ主題が `stories / architecture / specs` をまたぐ場合、**同名ファイルを避ける**
  - 例: `customer-onboarding-story.md`, `customer-onboarding-architecture.md`, `customer-onboarding-spec.md`

## 文書の親子関係

- `Frame` は複数の `Story` の親になってよい
- `Story` は 1つ以上の `Architecture` の親になる
- `Architecture` は 1つ以上の `Spec` の親になる
- `Spec` を飛ばして `Code` に行かない
- `Story` を飛ばして `Architecture` に行かない

## 文書間リンクのルール

- 新しい `Story` を作ったら、対応する `Frame` か親文書から参照できるようにする
- 新しい `Architecture` を作ったら、元になった `Story` を文中で参照する
- 新しい `Spec` を作ったら、元になった `Architecture` と `Story` を参照する
- `UI Concept` と `Runtime Architecture` がある場合は、必要なら **整合性マトリクス** を別紙で作る

## 判断に迷ったときの docs 分類

- 世界観、原則、語彙、ポジショニング → `frames`
- 誰が何を達成したいか、どういう体験か → `stories`
- どの責務がどこにあるか、正本は何か、どう投影するか → `architecture`
- 何が保存され、どう遷移し、どの command / event があるか → `specs`

## ガードレール
- ストーリーに仕様を混ぜない
- アーキに実装詳細を混ぜない
- 仕様なしでコードに行かない
- **TDDなしで実装に行かない（t_wada式）**
- 変更の正本は常に1つ（SSOTの所在を明示）
- AI-first SSOTは「人間可読性」を要求しない（ビューは生成物）

## 参照先（優先順）
- `/_codex/common/00_stories.md`（ユーザーストーリー正本）
- `/_codex/projects/brainbase/00_story_driven_development.md`（佐藤視点ストーリー）
- `/_codex/common/architecture_map.md`（アーキ正本）
- `/_codex/projects/brainbase/capabilities.md`（ストーリー受入条件の追跡）
- `/docs/specs/`（仕様が存在する場合はここ）

## ステップ別チェックリスト

### 1) Story
- [ ] 課題をストーリーに落とす（誰が・何を・なぜ）
- [ ] 受入条件（AC）を定義
- [ ] 仕様/実装への言及なし

### 2) Architecture
- [ ] 既存アーキとの整合を確認
- [ ] レイヤー/境界/データ層を明記
- [ ] SSOTの所在と役割を明確化

### 3) Spec
- [ ] API/スキーマ/フローを明文化
- [ ] ストーリーIDと紐付け
- [ ] 受入条件を仕様へ接続

### 4) TDD（t_wada式）
- [ ] Test Designerでテスト仕様を先に定義
- [ ] Red: 失敗するテストを書く
- [ ] Green: 仮実装→三角測量→明白な実装
- [ ] Refactor: 重複除去（テストは常にGreen維持）
 - [ ] テンプレ: `/_codex/common/specs/templates/tdd-test-design-template.md`

### 5) Code
- [ ] Spec準拠で実装が確定している
- [ ] 変更点を最小化
- [ ] 必要なテストが揃っている

## 判断に迷ったとき
- 「これはStoryか？Specか？」で分類し、混ざるなら分割する
- SSOTは人間可読より**機械可読**を優先する
- TDDを省略しそうなら `tdd-workflow` を強制起動する
