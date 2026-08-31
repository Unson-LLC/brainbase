# Brainbase Archify Diagrams

このディレクトリでは、Brainbase OSS版・組織版・将来到達像・判断データフローをArchifyのtyped JSON IRで管理します。

## Source of truth

編集対象は次の4ファイルです。

| File | Diagram type | Meaning |
|---|---|---|
| `platform-overview.archify.json` | `architecture` | OSS版と組織版の共有Kernel、包含関係、Mana、Domain Judgment Pack、CURRENT／FRONTIER／NORTH STAR |
| `current.archify.json` | `architecture` | accepted設計と実装済み主要境界を中心にした組織版の現在像 |
| `north-star.archify.json` | `architecture` | Organizational Intelligence Planeの到達像 |
| `data-flow.archify.json` | `dataflow` | 組織シグナルから判断・実行・学習までの流れ |

`generated/*.html`、`generated/*.svg`、`receipts/*.json`はGitHub Actionsが生成する派生物です。直接編集しないでください。

## Generated outputs

- `generated/platform-overview.html`: OSS版と組織版を統合したinteractive view
- `generated/current.html`: 組織版CURRENTのinteractive view
- `generated/north-star.html`: NORTH STARのinteractive view
- `generated/data-flow.html`: DATA FLOWのinteractive view
- `generated/*.svg`: GitHub上で直接読めるstatic view
- `receipts/*.validate.json`: schema・showcase quality validation result
- `receipts/*.deliver.json`: atomic delivery resultとspecification／artifact hash
- `receipts/platform-overview.visual-check.json`: 実Chromeによる4 desktop viewport・light／dark capture・containment result

## Pinned Archify

再現性のため、CIは`tt-a1i/archify`の次のcommitへ固定します。

```text
5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115
```

pinを変更する場合は、4図すべてのvalidate／deliverとPLATFORM OVERVIEWのvisual-checkを同じPRで行ってください。

## Local validation

```bash
git clone https://github.com/tt-a1i/archify.git /tmp/archify-repo
git -C /tmp/archify-repo checkout 5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115

ARCHIFY=/tmp/archify-repo/archify/bin/archify.mjs
SRC=docs/architecture/diagrams

node "$ARCHIFY" doctor

node "$ARCHIFY" validate architecture "$SRC/platform-overview.archify.json" --quality showcase
node "$ARCHIFY" deliver architecture "$SRC/platform-overview.archify.json" "$SRC/generated/platform-overview.html" --quality showcase
node "$ARCHIFY" visual-check "$SRC/generated/platform-overview.html" --json

node "$ARCHIFY" validate architecture "$SRC/current.archify.json" --quality showcase
node "$ARCHIFY" deliver architecture "$SRC/current.archify.json" "$SRC/generated/current.html" --quality showcase

node "$ARCHIFY" validate architecture "$SRC/north-star.archify.json" --quality showcase
node "$ARCHIFY" deliver architecture "$SRC/north-star.archify.json" "$SRC/generated/north-star.html" --quality showcase

node "$ARCHIFY" validate dataflow "$SRC/data-flow.archify.json" --quality showcase
node "$ARCHIFY" deliver dataflow "$SRC/data-flow.archify.json" "$SRC/generated/data-flow.html" --quality showcase
```

## Modeling rules

### PLATFORM OVERVIEW

- OSS版と組織版を左右対称の別製品として描かない。
- Shared OSS Judgment KernelとOSS Local-first Profileを分ける。
- 組織版は同じOSS packageをconsumeし、Server・組織正本・ガバナンス・managed operationを追加する構造として描く。
- PostgreSQL、Company Authority、Approval、ManaをOSS共通Kernelへ含めない。
- CURRENT、FRONTIER、NORTH STARをtagで明示し、箱の存在を本番完了とみなさない。
- Manaをauthorityの作者として描かず、Brainbaseが解決した権限を消費するoperatorとして描く。
- Domain Judgment PackはBrainbase Kernelが統治する業務固有DAGとして描く。

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

1. isolated run directoryへpinned Archifyを取得し`doctor`を実行
2. 4図を`showcase`品質でvalidate
3. 4図のself-contained HTMLをdeliver
4. PLATFORM OVERVIEWを実Chromeで1440×900、1600×1000、1920×1080、2048×1320に対してvisual-check
5. HTML内のSVGをstatic SVGとして抽出
6. generated assetsとreceiptを`[archify-generated]` commitで同じbranchへ書き戻す

生成commitではworkflowを再実行しないため、無限loopは発生しません。
