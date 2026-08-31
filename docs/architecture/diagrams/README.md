# Brainbase Archify Diagrams

このディレクトリでは、組織版Brainbaseの全体アーキテクチャをArchifyのtyped JSON IRで管理します。

## Source of truth

編集対象は次の3ファイルです。

| File | Diagram type | Meaning |
|---|---|---|
| `current.archify.json` | `architecture` | accepted設計と実装済み主要境界を中心にした現在像 |
| `north-star.archify.json` | `architecture` | Organizational Intelligence Planeの到達像 |
| `data-flow.archify.json` | `dataflow` | 組織シグナルから判断・実行・学習までの流れ |

`generated/*.html`、`generated/*.svg`、`receipts/*.json`はGitHub Actionsが生成する派生物です。直接編集しないでください。

## Generated outputs

- `generated/current.html`: CURRENTのinteractive view
- `generated/north-star.html`: NORTH STARのinteractive view
- `generated/data-flow.html`: DATA FLOWのinteractive view
- `generated/*.svg`: GitHub上で直接読めるstatic view
- `receipts/*.validate.json`: schema・quality validation result
- `receipts/*.deliver.json`: render delivery result
- `receipts/*.visual-check.json`: browser-based visual check result

## Pinned Archify

再現性のため、CIは`tt-a1i/archify`の次のcommitへ固定します。

```text
5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115
```

pinを変更する場合は、3図すべてのvalidate、deliver、visual-checkと差分レビューを同じPRで行ってください。

## Local validation

```bash
git clone https://github.com/tt-a1i/archify.git /tmp/archify-repo
git -C /tmp/archify-repo checkout 5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115

ARCHIFY=/tmp/archify-repo/archify/bin/archify.mjs
SRC=docs/architecture/diagrams

node "$ARCHIFY" doctor

node "$ARCHIFY" validate architecture "$SRC/current.archify.json" --quality showcase
node "$ARCHIFY" deliver architecture "$SRC/current.archify.json" "$SRC/generated/current.html" --quality showcase

node "$ARCHIFY" validate architecture "$SRC/north-star.archify.json" --quality showcase
node "$ARCHIFY" deliver architecture "$SRC/north-star.archify.json" "$SRC/generated/north-star.html" --quality showcase

node "$ARCHIFY" validate dataflow "$SRC/data-flow.archify.json" --quality showcase
node "$ARCHIFY" deliver dataflow "$SRC/data-flow.archify.json" "$SRC/generated/data-flow.html" --quality showcase
```

## Modeling rules

### CURRENT

- production稼働を推測で宣言しない。
- code、contract、provisioning、deployment、production readback、E2Eを混同しない。
- accepted ADRと現行コードが一致しない場合、差分をcardかtagで明示する。
- UIを正本として描かない。
- external runtimeがauthorityを持つように描かない。

### NORTH STAR

- Brainbase自身の責務とDomain Judgment Packの責務を分ける。
- Brainbaseが外部System of RecordやSecret Vaultを置換するように描かない。
- 人間の基準設定、Accountability、Human Gateを消さない。
- 自律化はsigned context、stop condition、Receipt、readbackと一組で描く。

### DATA FLOW

- raw signal、candidate、canonical fact、decision、authorized action、measured outcomeを分類する。
- candidateをcanonical truthへ直結させない。
- external side effectの後にはreadbackとReceiptを置く。
- learningはreview・scope・authorityを通過して初めてGraph／policy／DAGへ戻す。

## Stable IDs

component／node／connection／flow IDは、配置変更だけで不用意に変えないでください。Archify viewのfocus、差分レビュー、将来の自動整合性検査がIDへ依存します。

## CI behavior

`.github/workflows/archify-diagrams.yml`は、Archify JSONまたはworkflow変更時に次を行います。

1. pinned Archifyを取得し`doctor`を実行
2. 3図を`showcase`品質でvalidate
3. self-contained HTMLをdeliver
4. bounded visual check
5. HTML内のSVGをstatic SVGとして抽出
6. generated assetsとreceiptを`[archify-generated]` commitで同じbranchへ書き戻す

生成commitではworkflowを再実行しないため、無限loopは発生しません。
