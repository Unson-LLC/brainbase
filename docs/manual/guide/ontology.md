# Ontology 1.0.0

BrainbaseのOntologyは、ローカルPersonal OSに保存した事実を「どういう意味として扱うか」を定める公開契約です。データそのものではなく、AIやCLIが同じ意味と検証規則を共有するためのKernelです。

## 5つの領域

| 領域 | 1.0.0で定めること |
| --- | --- |
| 型 | `person`、`org`、`project`、`relationship`、`decision` の意味 |
| 関係語彙 | 人との関係、Decisionの `supersedes`、Decisionの `topic` |
| 制約 | ID重複、参照不整合、自己置換、循環などの監査rule |
| 推論 | 明示的な置換だけを根拠に有効Decisionを導出し、曖昧さは競合として返すrule |
| 変更管理 | version間の互換性、migration、rollback |

## データとOntologyの違い

`graph.json`や`decisions.jsonl`は、あなたが承認したローカルの事実です。Ontology 1.0.0は、それらの事実に対して「IDは重複してはいけない」「明示的に置換されたDecisionだけを過去扱いする」といった共通ルールを与えます。

Ontologyを有効にしても、データが外部へ送信されたり、自動修復されたりはしません。正本は引き続き `~/.brainbase/personal-os/` にあり、error違反があれば新しい正本書込みを開始前に拒否します。

## 監査する

```bash
brainbase ontology:show
brainbase ontology:audit
brainbase ontology:audit --ontology-version 0.0.0
```

監査結果の読み方:

- `complete` + `violationCount: 0`: 対象の正本を全件読めて、検出rule上の違反は0件
- `complete` + warning: 読取は完了したが、確認すべき意味上の不整合がある
- `complete` + error: 読取は完了したが、書込みを止める制約違反がある
- `unverified` + `violationCount: null`: ファイル欠損や破損で監査できない。0件ではない

`--ontology-version`を省略すると1.0.0で監査します。`0.0.0`はOntology Kernel導入前のlegacy解釈を表し、canonical fileの形式は検証しますが、1.0.0で追加された`effectiveAt`、supersession、conflict、意味制約を過去へ遡及適用しません。これにより、監査・推論結果に「どのversionの意味で読んだか」が必ず残ります。未対応versionは推測せず拒否します。

## 0.0.0から1.0.0へ更新する

1. `~/.brainbase/personal-os/`を別の場所へバックアップする。
2. 書込みを伴わない`brainbase ontology:audit --ontology-version 1.0.0`を実行する。
3. `error`があればupgrade後の書込みを始めず、rule IDとpathを確認する。重複IDや不正なsupersessionは、自動修復せず、バックアップを残したまま利用者が正しいrecordを選んで修正する。
4. `complete`かつerrorが0件になってから、`onboard:seed`、`onboard:projects --write`、`onboard:apply --write`を使う。

互換性は「既存recordを読める」という意味では保たれますが、1.0.0のcanonical writeは1.0.0監査がerrorなしであることを条件にします。既存の意味違反を黙って温存して書き足すことはしません。

### 初回公開時のrollback

`@unson/brainbase-mcp`の初回npm公開には、再インストールできる旧package versionがありません。導入前に、現在利用しているMCP client設定ファイルをコピーし、Brainbaseを起動しているcommandも記録してください。問題が起きた場合は次の順に戻します。

1. `npm uninstall -g @unson/brainbase-mcp`で初回公開packageを取り除く。
2. 退避したMCP client設定と従来の起動commandを復元する。
3. MCP clientを再起動し、従来のBrainbase接続を確認する。

既存packageからupgradeする将来のreleaseでは、upgrade前に記録した直前のversionを再インストールします。いずれも、監査後に利用者がcanonical fileを修正した場合だけ、必要に応じてupgrade前の`~/.brainbase/personal-os/`バックアップも復元します。Ontology commandを使わないだけでは、1.0.0で追加されたpre-write guardは無効になりません。

## Decisionの変更を表す

既存のDecision形式はそのまま読めます。明示的な変更関係が必要な場合だけ、追加fieldを使います。

```json
{
  "id": "decision-automated-deploy",
  "title": "Deployment policy",
  "decision": "Use automated deployment",
  "topic": "deployment",
  "supersedes": ["decision-manual-deploy"],
  "effectiveAt": "2026-08-03T00:00:00.000Z"
}
```

`effectiveAt`と推論の`asOf`はRFC 3339 date-timeです。`Z`だけでなく`+09:00`などのUTC offsetも利用でき、比較は表記上の文字列順ではなく実際の時刻で行われます。

同じ `topic` のDecisionが複数あっても、`supersedes` がなければBrainbaseは勝手に一方を採用しません。競合として返し、人が関係を確定できる状態を保ちます。
