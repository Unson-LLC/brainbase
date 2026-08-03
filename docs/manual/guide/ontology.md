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
```

監査結果の読み方:

- `complete` + `violationCount: 0`: 対象の正本を全件読めて、検出rule上の違反は0件
- `complete` + warning: 読取は完了したが、確認すべき意味上の不整合がある
- `complete` + error: 読取は完了したが、書込みを止める制約違反がある
- `unverified` + `violationCount: null`: ファイル欠損や破損で監査できない。0件ではない

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

同じ `topic` のDecisionが複数あっても、`supersedes` がなければBrainbaseは勝手に一方を採用しません。競合として返し、人が関係を確定できる状態を保ちます。
