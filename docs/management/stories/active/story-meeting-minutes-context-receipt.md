# Story: 議事録生成へ正本の文脈Receiptを提供する

## 利用者価値

manaで議事録を作成する利用者として、選択したプロジェクトの人物・組織・用語・過去の判断・未完了タスクをBrainbase Graphから取得し、その取得結果を同じ生成runへ固定したい。これにより、文字起こしだけを要約した議事録ではなく、正本の表記と過去判断を踏まえた議事録を再現可能な形で作成できる。

## 受け入れ条件

- [ ] AC1: 認証済みのmanaは、project code・run id・transcript hashを指定して上限付きの文脈Receiptを作成できる。
- [ ] AC2: ReceiptはGraphの取得状態を`resolved`、`confirmed_empty`、`partial`、`unavailable`で区別し、部分取得や障害を空扱いしない。
- [ ] AC3: Receiptは128 KiB以下で、entity 80件、未完了タスク50件、直近の承認済み議事録参照3件を上限とし、本文ではなく参照・要約・checksumを保存する。
- [ ] AC4: Claudeは専用MCPツールでrun id・project code・transcript hashが一致する同じReceiptだけを取得できる。
- [ ] AC5: Receipt利用はJudgment episodeへ記録され、Stop時にReceipt identityと専用MCP tool receiptが不足する場合はfail closedとなる。
- [ ] AC6: 既存のGraph、Task、Judgment Hook、一般MCPツールの契約を変更しない。

## 非対象

- 議事録生成からGraphのDecisionを自動作成・更新すること。
- 類似タスクを自動的に同一タスクとみなすこと。
- manaのSlack配信先を変更すること。

## リリース条件

Brainbaseを先に配備し、Receipt作成・取得・identity不一致拒否・既存MCP非回帰を本番で確認する。その後にmanaを観測モード、必須モードの順に配備する。
