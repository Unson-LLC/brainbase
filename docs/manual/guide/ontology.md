# オントロジーとは

オントロジーは、**会社の中にある人、組織、プロジェクト、判断などを、AIと人間が同じ意味で扱うための共通語彙と接続ルール**です。

難しい分類表を作ることが目的ではありません。「この名前は誰か」「この判断はどのプロジェクトへ適用されるか」「新しい方針が古い方針を置き換えたか」を、推測ではなく同じルールで答えられるようにします。

## なぜ必要なのか

文章検索だけでは、同じ言葉が同じ対象を指すとは限りません。

- 「佐藤さん」が同姓の別人かもしれない
- 「新規事業」が複数のプロジェクト名に使われているかもしれない
- 古い方針と新しい方針が両方見つかり、どちらが有効か分からない
- ある判断が全社方針なのか、特定プロジェクトだけの決定なのか分からない

オントロジーは、対象を安定したIDで区別し、接続できる関係と制約を決めます。これによりAIは、単語が似ている資料を集めるだけでなく、**誰の、どの仕事に、どの判断が適用されるか**をたどれます。

## 一枚で見る

![Brainbaseのオントロジー概念図。人物、組織、プロジェクト、判断を安定IDと関係で接続し、AIが同じ意味をたどる](/assets/brainbase-ontology.svg)

たとえば、図の「判断D-12」は単独の文章ではありません。

- `governs`で「プロジェクトP-03へ適用される」
- `supersedes`で「古い判断D-07を置き換える」
- プロジェクトP-03は`owned_by`で「組織O-01が所有する」
- 人物P-21は`participates_in`で「プロジェクトP-03へ参加する」

という意味を持ちます。表示名が変わってもIDと関係が同じなら、AIと人間は同じ対象を参照できます。

## オントロジー、Graph、Judgment DAGの違い

この3つは役割が異なります。

| 構造 | たとえるなら | 答える質問 |
| --- | --- | --- |
| オントロジー | 文法と交通ルール | 何を何として扱い、どの関係で接続してよいか |
| Graph SSOT | 会社の現在の地図 | 実際に誰がいて、どの組織・プロジェクト・判断と関係するか |
| Judgment DAG | 一つの判断の検討・実行経路 | 何を根拠に判断し、誰が許可し、何を実行し、どう評価したか |

オントロジーだけでは会社の実データは増えません。Graphへデータを置くだけでは、判断の検討順序や実行権限は決まりません。Judgment DAGだけでは、登場する人物やプロジェクトの意味を共有できません。

3つを分けて接続することで、会社の地図を使って、説明可能な判断と実行を組み立てられます。

## Ontology 2.0.0で定める公開契約

現在の公開OSS版では、Ontology 2.0.0がローカルPersonal OSに保存した事実を「どういう意味として扱うか」を定めます。正規エンティティ同士を安定IDのエッジで接続するため、人物名などの表示文字列が変わっても、同じ人物、プロジェクト、判断を区別できます。

## 正本と投影を分ける

`graph.json`のGraph v2が、正規エンティティと正規エッジの正本です。`personal-kg.jsonl`、`relationships.json`、`decisions.jsonl`は用途別の情報を保持しますが、正規Graphの代わりではありません。

正規エッジはRelation Registryに登録された関係だけを使います。代表例は次のとおりです。

- 人物からプロジェクトへの参加: `participates_in`
- 判断からプロジェクトへの適用: `governs`
- 新しい判断から古い判断への置換: `supersedes`
- 組織とプロジェクトの所有関係: `owned_by`

存在しないID、型が合わない接続、未知の関係、重複した接続は保存前に拒否します。自由文の役割から関係を推測して正規エッジへ昇格しません。

## 5つの領域

| 領域 | 2.0.0で定めること |
| --- | --- |
| 型 | `person`、`org`、`project`、`decision`の意味 |
| 関係語彙 | Relation Registryに登録されたIDエッジと接続可能な型 |
| 制約 | ID重複、参照不整合、自己置換、循環などの監査規則 |
| 推論 | 明示された有効時点とエッジだけを根拠に判断し、曖昧さを残す規則 |
| 変更管理 | version間の互換性、移行、ロールバック |

Ontologyを有効にしても、データが外部へ送信されたり、自動修復されたりはしません。正本は引き続き `~/.brainbase/personal-os/` にあり、error違反があれば新しい正本書込みを開始前に拒否します。

## 監査する

```bash
brainbase ontology:show
brainbase ontology:audit
brainbase ontology:audit --ontology-version 1.0.0
brainbase ontology:audit --ontology-version 0.0.0
```

監査結果の読み方:

- `complete` + `violationCount: 0`: 対象の正本を全件読めて、検出規則上の違反は0件
- `complete` + warning: 読取は完了したが、確認すべき意味上の不整合がある
- `complete` + error: 読取は完了したが、書込みを止める制約違反がある
- `unverified` + `violationCount: null`: ファイル欠損や破損で監査できない。0件ではない

Graph v2では、記録されたOntology bindingを使います。legacy Graphでversion指定を省略した場合は、現行の2.0.0を使います。`1.0.0`は最初のportable release、`0.0.0`はKernel導入前の履歴解釈です。未対応versionは推測せず拒否します。

## Graph v1からv2へ移行する

最初にPersonal OSをバックアップし、書き込まないpreviewを実行します。

```bash
brainbase ontology:migrate --dir ~/.brainbase/personal-os
```

結果が`blocked`なら書き込まず、`issues`にある重複ID、曖昧な人物、未解決参照などを確認します。Brainbaseは複数候補から正規IDを推測しません。

`migration_required`なら、previewが返した`expectedInputDigest`をそのまま指定して適用します。

```bash
brainbase ontology:migrate \
  --dir ~/.brainbase/personal-os \
  --write \
  --expected-input-digest "<previewで返った値>"
```

書込み直前に4つの正本をlock内で再読込します。preview後に内容が変わっていればdigest不一致で拒否し、古い計画を適用しません。書込みは4ファイルを一括で行い、途中失敗時は元の状態へ戻します。再実行済みのGraph v2は`up_to_date`となり、内容を書き換えません。

### 戻すとき

移行前に作成したPersonal OSのバックアップと、導入前のpackage versionを記録してください。問題が起きた場合は、Brainbaseを停止してからバックアップを復元し、記録したpackage versionを再インストールします。`graph.json`だけを単独で戻すと4ファイルの整合性が崩れるため、Personal OS全体を同じ時点へ戻します。

## Decisionの変更を表す

既存のDecision形式はそのまま読めます。明示的な変更関係が必要な場合だけ、`supersedes`と`effectiveAt`を使います。移行時には同じIDの正規Decision entityと、必要な`governs`・`supersedes`エッジが作られます。

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

`effectiveAt`と検索・解決時の`asOf`はRFC 3339 date-timeです。同じtopicのDecisionが複数あっても、`supersedes`がなければBrainbaseは勝手に一方を採用しません。競合として返し、人が関係を確定できる状態を保ちます。
