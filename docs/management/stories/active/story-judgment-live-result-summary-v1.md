---
story_id: story-judgment-live-result-summary-v1
title: Judgment監査の検索結果要約を実結果に一致させる
source_requirement:
  source: Codex conversation 2026-08-29
  approved_at: 2026-08-29
spec_docs:
  - .vibepro/spec/story-judgment-live-result-summary-v1/spec.json
pr_scope_strategy: atomic_single_pr
status: active
created_at: 2026-08-29
updated_at: 2026-08-29
---

# Judgment監査の検索結果要約を実結果に一致させる

## Story

Brainbase監査を長時間taskの継続証跡として使うownerとして、fresh taskの実呼出が0件・結果取得・失敗のどれだったかを、保存された監査行だけで誤認なく確認したい。

## 背景

fresh task E2EではHook lifecycle、4件のBrainbase call、Stop修復、complete finalまで到達した。一方、Graph検索が返した「該当なし（不在確定ではない）」と取得結果の意味をHostが捨て、すべて「正常応答を確認」と保存したため、live-session Gateが11/12で失敗した。

## 受け入れ基準

- [ ] AC-001: 成功した検索応答が明示する0件は「該当なし（不在確定ではない）」として保存する。
- [ ] AC-002: 成功した検索・取得応答が結果取得を明示する場合は「結果を取得」として保存する。
- [ ] AC-003: query/targetはtool inputからHostが生成し、応答本文のquery、件数、秘密、任意の監査行を転載しない。
- [ ] AC-004: 構造化件数がある既存toolと、結果意味が判定不能な応答のfail-closed表示を変更しない。
- [ ] AC-005: fresh task live-session E2E 12/12がexact HEADで通る。

## スコープ外

- Brainbase MCP自体の検索・取得schema変更
- 保存済みepisodeの書き換え
- Judgment episode lifecycle、required capability、owner監査、Stop修復の変更
