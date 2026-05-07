# VibePro Brainbase Dogfood Feedback: ConversationLinker Load Shedding

## 状態

正解ラベルに基づいて採点済み。

## 指標

- 本番化ギャップ捕捉率: 1
- 本番化ギャップ的中率: 1
- ゲート違反流出率: 0

## 正しく検出できた本番化ギャップ

- `gap.conversation_linker.repeated_codex_jsonl_reads`
- `gap.activity_logs.high_frequency_info`

## 次回診断ルール更新候補

- runtime反映後のLoki再測定を次runの観測factに含める。
