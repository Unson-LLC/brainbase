---
story_id: story-companion-canonical-task-provider
title: Mac Companion向け正本Task APIと承認時の一度だけ作成
status: active
date: 2026-07-14
architecture_docs:
  - docs/architecture/story-companion-canonical-task-provider.md
spec_docs:
  - docs/specs/story-companion-canonical-task-provider-spec.md
---

# Mac Companion向け正本Task APIと承認時の一度だけ作成

## 背景

BrainbaseはNocoDBのTask表をTaskの正本として既に利用している。一方、既存の
`/api/nocodb/tasks` は担当者を自由入力の表示名として扱い、Mac Companionが必要とする
版管理、発生元、待ち状態、冪等作成を契約として提供していない。

Mac Companion側に別のTask正本を作るのではなく、Brainbaseが既存Task表を正規化した
Companion APIを提供する。また、会議のTask候補を承認したときも同じ正本へ一度だけ
Taskを作成し、承認済みなのにTaskがない状態と、再試行による重複を防ぐ。

## ユーザーストーリー

佐藤として、Mac Companionで自分のTaskを確認・登録・進行・待ち・完了に変更したい。
どの操作もBrainbaseのTask正本へ反映され、担当者はGraph PeopleのIDで一意に決まり、
会議から承認したTask候補は同じTaskとして一度だけ現れてほしい。

## 受け入れ基準

- [ ] **ac:1 canonical-list**: 認証済みownerが `GET /api/companion/tasks` で正本Taskを状態、担当者、期限条件付きで取得でき、cursorで続きを取得できる。
- [ ] **ac:2 canonical-create**: `POST /api/companion/tasks` は必須の冪等キーを受け、同じ要求の再送では同じTaskを返し、内容が異なる再利用は409にする。
- [ ] **ac:3 canonical-update**: `PATCH /api/companion/tasks/:taskId` と状態遷移APIは期待版を必須にし、不一致を409で返す。
- [ ] **ac:4 person-id-boundary**: 担当者はGraph SSOTの `person_id` だけを入力権限とし、表示名は投影として保存する。存在しないIDは拒否し、旧自由入力値を推測でID化しない。
- [ ] **ac:5 lifecycle**: Taskは `pending`, `in_progress`, `waiting`, `completed` を持ち、待ち対象、再確認日時、完了日時を正本へ保存する。
- [ ] **ac:6 source-and-audit**: 発生元参照と変更者を保存し、作成・更新・状態遷移をBrainbase監査ログへ残す。
- [ ] **ac:7 fail-closed**: NocoDBまたはGraphが利用不能な場合、空一覧や未担当として成功扱いせず、構造化503を返す。
- [ ] **ac:8 approval-materialization**: `task_store` を書き戻し先に持つ会議Task候補の承認は、Task作成が全件成功した後だけhuman stepをapprovedにし、応答消失後の再試行でも同じTask ID群を返す。
- [ ] **ac:9 compatibility**: 既存 `/api/nocodb/tasks` とTask以外の承認フローは挙動を変えない。
- [ ] **ac:10 auth**: Companion Task APIは既存Companion APIと同じnative/service/internal認証およびowner境界を通る。

## 実装タスク

1. `[DB]` 既存Brainbase Task表へ正規化メタデータ列を確認・追加する移行スクリプトを作る。
2. `[BE]` NocoDB Task repositoryとGraph People検証を組み合わせた正本Task serviceを作る。
3. `[BE]` `/api/companion/tasks` の一覧、作成、更新、状態遷移を既存認証境界へ登録する。
4. `[BE]` Workflow `task_store` 承認を同じ作成serviceへ接続し、冪等な再試行を保証する。
5. `[QA]` BDD、route integration、repository unit、既存承認回帰を実行し、VibeProへ証跡を記録する。

ブランチ: `codex/canonical-task-provider`

## スコープ外

- Mac Companion UIの実装。
- 旧自由入力担当者の自動名寄せ。
- 全プロジェクトの既存Task表を一括統合する移行。
- NocoDBを置き換える新しいTaskデータベースの導入。
