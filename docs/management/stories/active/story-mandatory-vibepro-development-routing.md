---
story_id: story-mandatory-vibepro-development-routing
title: 開発依頼をVibeProの最小ループへ必ず接続する
source_requirement:
  source: Codex conversation 2026-08-31
  approved_at: 2026-08-31
architecture_docs:
  - path: N/A
    status: not_required
    reason: "既存Judgment Hostの確定済みimplement分類へ開発手順を追加するだけで、権限、データ、外部作用、デプロイ境界を変更しないため。"
spec_docs:
  - docs/specs/story-mandatory-vibepro-development-routing.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "Hostの実装依頼ルーティング、常時指示、回帰テストを同じ変更で固定し、一部だけ反映された状態を作らないため。"
status: active
created_at: 2026-08-31
updated_at: 2026-08-31
---

# 開発依頼をVibeProの最小ループへ必ず接続する

## Story

Brainbase管理下で開発を依頼する利用者として、依頼文にVibeProと明記しなくても、Judgment Resolverが`implement`と確定した変更・修正・実装はVibeProのStoryから始まってほしい。これにより、LLMの任意のSkill選択だけに依存せず、Story、Spec、実装、影響テスト、レビュー、PRのつながりを毎回維持できる。

## 背景

直近の「修正して」という依頼は`implement`として認識されたが、`verify-first-debugging`、TDD、Git Skillだけが選ばれ、VibePro Skill、Story、Specへ切り替わらなかった。常時指示が「For VibePro work」「When the user asks for VibePro work」という循環的な条件だったため、明示されていない開発依頼をVibePro対象にする決定的な開始ルールがなかった。

## 受け入れ基準

- [x] Judgment Hostは確定済みclassificationのintentが`implement`なら、利用者がVibeProと明記していなくてもVibePro Skillを使い、コード変更前にStoryとSpecを用意するよう追加文脈へ固定指示する。
- [x] `diagnose`、`answer`、純粋な`operate`などの非implement turnへ、この開発開始指示を誤注入しない。
- [x] `AGENTS.md`と`CLAUDE.md`は、Brainbase管理下のimplement依頼にVibePro最小ループを必須適用する同一の常時契約を持つ。
- [x] VibeProは組織判断、権限、merge承認を代替せず、既存の最小ループと通常のリポジトリ権限境界を維持する。
- [x] 回帰テストは、曖昧な「VibePro workなら使う」という条件だけへ戻る変更を検出する。

## スコープ外

- 旧general-purpose Gate DAG、managed worktree必須、mandatory Agent Review Gateの復活
- VibeProによるmerge、deploy、外部作用の許可
- Judgment Resolverのintent分類、risk、autonomy decisionの再計算
