# 人物supersession Ontology 1.1.0 アーキテクチャ

## 境界

- 正本語彙: `config/ontology/releases/1.1.0.json`
- version選択とdigest拘束: `config/ontology/index.json`
- runtime検証: `OntologyRegistry`と`OntologyKernel`
- 公開権限: Graph Decision/RACIを検査する既存publication authority
- 公開成果物: 署名Receipt、current index、compatibility view

## 設計判断

`alias_of`はalias型からcanonical型への名称解決であり、`person`同士の旧ID統合には使わない。新しい`superseded_by`は`person -> person`、many-to-one、persistent、explicitとする。旧人物IDを削除せず、一つのcanonical人物へ解決する関係を表す。

1.1.0は関係型の追加だけなのでadditive minor releaseとし、データmigrationは要求しない。既存Batch 1 Edgeが追加語彙の最初の実データとなる。

## 安全性

- endpointはperson同士に限定する。
- many-to-oneにより一つの旧人物から複数canonical人物への分岐を拒否する。
- 1.0.0のrelation、constraint、inferenceをそのまま保持する。
- current切替は既存のDecision/RACI/Ed25519 publisher以外では行わない。
- 全Graphに残る既存品質課題と、このadditive変更が新たに導入する違反を分離して報告する。
