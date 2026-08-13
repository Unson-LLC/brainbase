# Judgment・Knowledge参照詳細の監査表示設計

## 目的

Brainbaseがすでにreceiptへ保存している判断理由と参照先の採否を、owner向けの監査行で欠落なく確認できるようにする。分類やルーティングは変更せず、既存receiptから安全な表示を決定論的に生成する。

## Graphifyで確認した境界

- `JudgmentResolutionService.resolve`は`project_code`と`reconciliation_reasons`をreceiptへ保存する。
- `buildOwnerAudit`がJudgment receiptをowner向け`display_line`へ投影する。
- `KnowledgeResolutionService.resolve`は`source_class`、`canonical_location`、`excluded_sources`をreceiptへ保存する。
- `recordBrainbaseToolUse`はKnowledge Resolver応答を抽出し、`routeDisplayLine`でjournalの`display_line`を作る。
- Stopは保存済み`display_line`の存在と順序を検査するため、表示詳細を同じ1行内に追加すればlifecycle契約は維持できる。

## 設計

### Judgment receipt

`buildOwnerAudit`のclarification分岐で、既知の`reconciliation_reasons`を日本語の短い説明へ写像する。`project_code`は安全な短縮処理を通し、値がある場合だけ`project=<code>`として表示する。

未知のreasonは捨てず、安全に正規化したreason IDを表示する。これにより新しいreasonが追加されても「理由なし」へ退行しない。

### Knowledge Resolver receipt

`routeDisplayLine`は次を同じ監査行へ含める。

1. 採用した`source_class`
2. `canonical_location`から得られるprojectを含む正規位置
3. tool inputの`content_type`に対応する選択理由
4. `excluded_sources`の全要素と、receiptが返した各reasonの日本語要約

除外理由は既知のKnowledge Resolver reasonを日本語へ決定論的に写像する。未知のreasonは安全に短縮して表示し、要素数はreceipt schemaの範囲内で全件を維持する。

### 安全性と不変条件

- すべての可変値を1行化し、秘密らしい値、制御文字、`<`、`>`、日本語引用符を正規化する。
- 表示はreceiptの監査投影であり、分類・ルーティング・capability達成判定には使わない。
- `display_line`は1 eventにつき1行を維持し、Stopの順序検査を変えない。
- raw tool responseはjournalへ保存しない。

## 影響範囲

- 実装: `scripts/codex-hooks/judgment-resolver-host.mjs`
- 単体テスト: `tests/unit/judgment-resolver-host.test.js`
- 結合テスト: `tests/integration/judgment-resolver-host-entrypoint.test.js`

`server/services/judgment-resolution-service.js`と`server/services/knowledge-resolution-service.js`はreceipt項目をすでに提供しているため変更しない。
