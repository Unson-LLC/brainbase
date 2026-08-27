---
layout: home

# brainbase:public-message:hero:start
hero:
  name: Brainbase
  text: "会社の判断を、属人化させない。"
  tagline: "Brainbaseは、経営者や担当者の判断基準、過去の決定、その理由を会社に残し、AIや次の担当者が同じ前提で考え、動けるようにする仕組みです。"
  image:
    src: /assets/brainbase-hero.webp
    alt: 判断基準、決定理由、実行結果をBrainbaseへ残し、AIと人間が引き継ぐ流れ
  actions:
    - theme: brand
      text: Brainbaseを理解する
      link: /guide/grand-design
    - theme: alt
      text: 10分で試す
      link: /guide/quick-start
    - theme: alt
      text: 現在の実装を見る
      link: /guide/status
# brainbase:public-message:hero:end

features:
  - title: 判断の理由が残る
    details: 何を決めたかだけでなく、誰のために、何を優先し、何を守り、なぜその判断を選んだかを残します。
  - title: AIと担当者が同じ基準で考える
    details: プロジェクトの目的、関係者、過去の決定、判断基準を必要な時に参照します。
  - title: 任せる範囲を明確にする
    details: 人間が決めることと、AIが探索・反証・実行してよい範囲を分けます。
  - title: 結果から判断を更新する
    details: 実行結果を評価し、古い前提や判断を見直せる状態へつなげます。
---

<!-- brainbase:public-message:start -->
## 人の頭の中にある判断を、AIと会社が引き継げるようにする。

人間が、目的と判断基準、任せてよい範囲を決める。  
AIは、それをもとに調べ、選択肢を比較し、見落としを指摘し、許可された仕事を進める。

Brainbaseが残すのは、単なる資料の置き場所ではありません。何を目指し、誰のために、何を優先し、何を守り、なぜその判断を選んだのかを、次の人やAIが再利用できる形で残します。
<!-- brainbase:public-message:end -->

## 資料が残っていても、判断は残っていない

多くの会社には、議事録、Slack、メール、ドライブ、ソースコードがあります。それでも、重要な判断は経営者や担当者へ集中します。

理由は単純です。資料には「何があったか」は残っても、次の情報が十分に残らないからです。

- なぜこの顧客を優先したのか
- なぜ売上になる提案を断ったのか
- 何を守るために、この方針を選んだのか
- 誰にどこまで任せてよいのか
- 結果が悪かった時に、どの前提を変えるべきか

Brainbaseは、これらを判断の構造として残します。

## 同じ情報でも、会社によって正しい判断は違う

たとえば、ある案件を受けるべきかAIへ聞いたとします。

売上と利益率だけを見るAIは、受注を勧めるかもしれません。しかし会社の方針が「単発受託を増やさず、再利用できる資産になる案件だけを取る」なら、その回答は会社にとって正しくありません。

Brainbaseを参照するAIは、短期売上だけでなく、経営者の稼働、再利用性、既存方針、守るべき関係を確認します。そのうえで、受注する条件や断る理由まで説明できます。

## Brainbaseを支える3つの構造

Brainbaseは、情報を一か所へ集めるだけのデータベースではありません。次の3つを分けて持つことで、会社の言葉を揃え、判断の理由をたどり、許可された仕事だけを動かします。

| 構造 | 役割 |
| --- | --- |
| オントロジー | 人物、組織、プロジェクト、判断などの意味と、接続してよい関係を定める |
| Graph SSOT | 実在する人物、組織、プロジェクト、判断と、それらの関係を正本として持つ |
| Judgment DAG | どの証拠から何を判断し、どの権限で実行し、結果をどう評価したかをつなぐ |

[仕組みを一枚の構成図で見る](/guide/architecture) · [オントロジーとは何かを見る](/guide/ontology)

## 現在試せるもの

公開OSS版は、まず個人の仕事文脈と判断基準をローカルへ置き、CodexやClaude Codeへ渡すところから始めます。

- Graph v2とOntology 2.0.0で人物・組織・プロジェクト・判断を接続する
- `resolve_entity`、`get_context`、`search`で依頼を正しい文脈へつなぐ
- Judgment DAGの型と依存関係を検証する
- ローカルの決定論的runnerでDAGを実行する

組織向けガバナンスやreplay/evaluationなど、まだ計画中の機能もあります。誇張せず、[現在の状態](/guide/status)で境界を明示しています。

## 次に読む

- [Brainbaseの全体像](/guide/grand-design)
- [仕組みとシステム構成](/guide/architecture)
- [オントロジーとは](/guide/ontology)
- [Judgment DAGの考え方](/guide/judgment-system)
- [10分で試す](/guide/quick-start)
- [現在の状態](/guide/status)
