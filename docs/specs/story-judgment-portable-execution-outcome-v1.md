---
spec_id: SPEC-JUDGMENT-PORTABLE-EXECUTION-OUTCOME-V1
story_id: story-judgment-portable-execution-outcome-v1
status: proposed
updated_at: 2026-09-08
---

# AI実行環境に依存しない判断結果仕様

## 共通境界

各Host adapterは固有の入力・Hook・ログを読み、`brainbase-conversation-context-v1`へ正規化する。Resolver中核はCodex JSONLやClaude Code transcriptを直接読まない。現時点で結果を生成・保存する実装はCodex adapterに接続済みで、Claude Code adapterの実装と本番有効化はこのStoryの完了に含めない。

実行後は `judgment_execution_outcome.v1` を生成する。必須要素はHost種別とadapter版、実行・turn識別子、完了範囲（`host_turn | external_effect`）、状態、到達段階、証拠状態である。`completed`以外では `failure` と `resume_from` が必須となる。`completed` は確認済みの証拠参照を1件以上必要とする。

段階は `open | resolve | execute | finalize | deliver | readback`、状態は `completed | partial | failed | blocked | unknown` とする。`external_effect` の成功では、`deliver`は受付、`readback`は受信側確認として分離し、readback未確認を`completed`にしない。`host_turn` の完了はターン自体の確定だけを意味し、外部配信の成功を含まない。

## Adapter境界

CodexのHook名、trust、JSONL/SQLiteはCodex adapterの診断証拠である。Claude Code側も自身のHook・保存形式をadapter内で検証する。どちらもBrainbase共通結果のフィールドや成功条件にはしない。

未登録Host、欠落した失敗理由、欠落した再開地点、競合する識別子は明示的に拒否する。汎用的な「失敗」に丸めず、安全な上流エラーコードを `failure.upstream_code` に保持できる。Host名とadapter版は診断用metadataであり、それ自体を認証証拠にはしない。
