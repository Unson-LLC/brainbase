---
name: sns-account-factory
description: brainbaseのSSOT（_codex）と工場出荷ライン前提で、SNSアカウント設計（返信/プロフィール遷移の逆算、レーン設計、運用ルール更新）を行う
---

# SNS Account Factory（brainbase版）

目的: **返信・プロフィール遷移**を起点に、brainbaseのSSOTと工場ラインへ落とすアカウント設計を行う

## 使うタイミング
- SNSアカウント設計をやり直したい
- 返信/プロフィール遷移を増やしたい
- 投稿ルールを工場ラインに落としたい

## 参照するSSOT（最小）
必ず以下を読む（ある前提）:
- `_codex/sns/x_account_profile.md`
- `_codex/sns/sns_strategy_os.md`
- `_codex/sns/x/00_line_charter.md`
- `_codex/sns/x/ops/variety_gate.md`
- `_codex/sns/x/ops/runbook.md`

## ワークフロー（逆算設計）

### 1) 行動ゴールから逆算する
**ゴールを明確化**:
- 返信（その場で反射的に返す）
- プロフィール遷移（続きを見ないと損）

**逆算フレーム**:
- 行動 → きっかけ → 必要証拠  
（例: 返信 → 低コスト回答 → A/B選択 or 一行回答）

### 2) WHO×WHATを再確認
マーケティング・コンパスのWHO×WHATで定義:
- WHO: 少人数で事業を回す経営者/PM/事業責任者  
- WHAT: マネジメント自動化の実験ログ・判断の型・失敗と学び

**逆ペルソナも離脱しない構造**を意識する

### 3) アカウント設計（Promise/Proof/Path）
プロフィールはこの順で設計:
- **Promise**: 誰に何を約束するか
- **Proof**: それを信じられる理由（実装/数字/実例）
- **Path**: 次に何をすれば得か（追う理由）

### 4) レーン設計（SNSの揺れを担保）
全投稿に同一ルールを当てない  
**運用はレーン分けで行う**

- レーンA: ドラマ（悩み→判断→結果→未完了）
- レーンB: 断定（断定＋根拠1つ）
- レーンC: 実験ログ（数字＋固有名詞）
- レーンD: 共感/日常（温度感＋小ネタ）

### 5) 返信/遷移トリガー設計
**返信を増やす投稿**:
- A/B/一行回答で返せる問い
- 俺の行動 → あなたなら？ の流れ

**プロフィール遷移を増やす投稿**:
- 投稿内で「続きの場所」を暗示
- 結論は出すが、**次の一手はプロフィールで回収**

### 6) SSOTに反映する（必須）
以下を更新:
- `_codex/sns/x/00_line_charter.md`（レーン/必須要素）
- `_codex/sns/x/ops/variety_gate.md`（レーン条件）
- `_codex/sns/x/ops/runbook.md`（日次運用）
- `_codex/sns/x_account_profile.md`（Promise/Proof/Path）

## 出力フォーマット（最小）
- アカウントのPromise/Proof/Path案
- レーン配分（今日/週）
- SSOT差分（ファイル更新）

## 注意
- **画一ルール禁止**。必ずレーン運用で揺れを残す
- **SSOTは_codex**。NocoDBは運用DB
