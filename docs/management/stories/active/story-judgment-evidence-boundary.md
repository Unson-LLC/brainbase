---
story_id: story-judgment-evidence-boundary
title: Judgmentが命令・資料・根拠・完了を混同しない
architecture_docs:
  - path: docs/architecture/story-judgment-evidence-boundary.md
    status: accepted
spec_docs:
  - .vibepro/spec/story-judgment-evidence-boundary/spec.json
status: active
created_at: 2026-08-13
updated_at: 2026-08-13
---

# Judgmentが命令・資料・根拠・完了を混同しない

## Story

Brainbaseの判断監査を使う利用者として、現在の依頼、貼り付けた資料、内部指示、ツールの処理結果を別のものとして扱いたい。監査手続が完了しただけで、回答内容や書き込み結果まで正しいと誤認したくない。

## 背景

実セッションで、内部注入された`AGENTS.md`が過去の利用者発言として残り、会話ログ中の`PR`や`外部公開`が現在の実行指示として分類された。またtask書込では入力が「入力なし」と表示され、未知の応答や失敗応答内の任意の監査文を成功として見せられる境界があった。

## 受け入れ基準

- [ ] 既知のAGENTS、環境、アプリ、Hook等の内部envelopeを会話履歴から除外する。
- [ ] 明示された添付、引用、会話ログ、コードブロックは現在命令の決定的matcherに使わず、直接命令は従来どおり分類する。
- [ ] create/update/transition taskはwriteとして記録し、安全な対象項目を表示する。
- [ ] null、空、未知形式、明示エラーは成功表示にせず、失敗応答内の任意の`📚`行を監査正本にしない。
- [ ] final receiptは監査手続の完了と回答内容の検証状態を別項目で示し、既存の`completion_status`互換を維持する。
- [ ] unitとintegrationで上記境界を回帰検証する。

## スコープ外

- Codex DesktopがStop前の候補回答を表示済みにする挙動
- flatten済み自由文に含まれる全ての引用・資料を完全に識別すること
- 自由文回答のclaim単位で根拠の正しさを保証すること

これらはHostからorigin付き入力またはclaim-evidence構造を受け取る上流契約が必要であり、別Storyとする。
