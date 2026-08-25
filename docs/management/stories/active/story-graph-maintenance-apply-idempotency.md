# Story: Graph Maintenance Applyの冪等Receipt readback

## 利用者価値

Graph管理者として、適用済みPlanを安全確認のため再送したとき、現在のHuman Gate契約が変わっていてもGraphを再変更せず、元のApply Receiptを取得したい。

## 背景

複数Decisionを含む旧Planは適用済みでReceiptも存在するが、現在の`applyPlan`はReceipt確認より先に単一Decision Human Gate制約を評価する。そのため、同一Planの冪等再送が`GRAPH_APPLY_HUMAN_GATE_SCOPE_UNSUPPORTED`で失敗する。

## 方針

plan ID・tenant・project・base snapshot hashを検証した後、既存Apply Receiptを先に返す。未適用Planに対する現在のHuman Gate検証順序とfail-closed動作は変えない。

## 受け入れ条件

- [x] AC-001: 適用済みPlanの同一入力は既存Apply Receiptを返し、Graph mutationを実行しない。
- [x] AC-002: 未適用の複数Decision Planは従来どおり構造化409で停止する。
- [x] AC-003: plan ID、tenant、project、base snapshot hashの検証はReceipt readbackより前に維持する。
- [x] AC-004: Graph Maintenance serviceとREST契約テストが通る。

## ADR判断

不要。永続化形式や公開APIを変更せず、既存の冪等Apply契約に検証順序を戻す局所修正のため。
