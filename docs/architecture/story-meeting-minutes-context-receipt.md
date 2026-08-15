# Architecture: 議事録文脈Receipt

## 決定

Brainbaseを議事録生成文脈の正本所有者とする。manaは生成前にBrainbaseへ文脈スナップショットの作成を要求し、Claudeは専用MCPツールから同じReceiptを読む。manaやClaudeがGraph検索結果を独自に正本化しない。

## Receipt

Receiptは`meeting_minutes_context.v1`とし、`receipt_id`、`run_id`、`project_code`、`transcript_sha256`、`status`、`searched_scope`、`resolved_at`、`checksum`、`context`を持つ。`context`はプロジェクト、人物、組織、用語、判断候補、未完了タスク、直近の承認済み議事録参照、source refsで構成する。

取得元の一部が失敗した場合は`partial`、全体が利用不能なら`unavailable`とする。取得が正常に完了し0件だった場合だけ`confirmed_empty`を許す。`partial`と`unavailable`はHTTP成功へ丸めない。

## データフロー

1. manaが文字起こしを取得しSHA-256を計算する。
2. manaがBrainbaseへproject/run/hashを送り、Graph・Canonical Task・承認済み議事録参照を解決する。
3. Brainbaseが上限付きReceiptを永続化し、identityとchecksumを返す。
4. manaがReceipt identityをrunへ保存し、Claude promptへrun/project/hash/receipt idを渡す。
5. Claudeが`brainbase_get_meeting_minutes_context`を呼び、同じidentityのReceiptを取得する。
6. Judgment Hookがtool receiptを同じepisodeへ記録する。Stop監査が不足を検知した場合は生成を完了させない。

## 信頼境界

- bearer認証とproject accessをbody読取前後の既存境界で維持する。
- MCP toolは引数4要素をすべて照合し、Receipt idだけで別runの文脈を読めない。
- Receiptは128 KiB、entity 80、task 50、minutes ref 3を上限とする。
- 生の文字起こし、Graph全文、秘密情報はReceiptへ保存しない。
- 判断は候補として返し、Graphへ自動書き込みしない。

## 配備順序

Brainbase API/MCP -> 本番readback -> mana observe -> Receipt証跡確認 -> mana required。
