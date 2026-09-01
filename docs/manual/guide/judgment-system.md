# Judgment DAGの考え方

<!-- brainbase:public-message:start -->
同じ説明を繰り返さず、最初から本題へ。

人間は、仕事の目的、判断基準、任せてよい範囲を決める。  
AIは、それらを参照して選択肢を比較し、見落としを指摘し、許可された範囲を進める。

この価値を実現する内部構造を、Brainbaseでは **Judgment DAG** と呼びます。DAGは商品コピーではなく、判断の根拠・依存関係・実行・評価を壊さず扱うための技術モデルです。
<!-- brainbase:public-message:end -->

## オントロジーとGraphとの関係

オントロジーは「人物、組織、プロジェクト、判断を何として扱い、どう接続してよいか」を定めます。Graph SSOTは、そのルールに従って会社の実際の対象と関係を持ちます。

Judgment DAGは、それらを参照しながら、**今回の判断がどの証拠に依存し、誰の承認で、どの実行と評価へ進むか**を表します。

```text
オントロジー     意味と接続ルール
      ↓
Graph SSOT       会社の確定した対象と関係
      ↓
Judgment DAG     今回の判断・権限・実行・評価の経路
```

全体の位置関係は[仕組みとシステム構成](/guide/architecture)、具体的な関係の例は[オントロジーとは](/guide/ontology)を参照してください。

## DAGとは何か

DAGは、処理や判断の依存関係を一方向につないだグラフです。

Brainbaseでは、ある判断が何を根拠にし、何を許可し、どの実行と結果につながったかを明示します。

```text
市場の変化を観察した
        ↓
既存方針では機会を逃すと判断した
        ↓
試験導入へ使える予算と範囲を決めた
        ↓
提案と実装を行った
        ↓
成果と失敗を評価した
        ↓
方針を維持・修正・廃止した
```

単なる履歴ではありません。下流の判断や実行が、どの上流ノードへ依存するかを検証できます。

## 5つの層

### 1. Context / Observation

事実、観察、指標、時点、情報源を正規化します。

この層では、まだ戦略を選びません。下流が同じ事実を参照できる状態を作ります。

### 2. Judgment / Decision

Contextを解釈し、優先順位、適合性、go/no-go、方針などを決めます。

判断nodeが生の情報源を隠れて読み直したり、実行状態を直接変更したりしてはいけません。

### 3. Resource / Risk

判断を、予算、時間、人員、リスク上限、承認条件、実施範囲へ変換します。

ここで「やるべき」を「どこまでなら実行してよい」へ変えます。

### 4. Execution / Outcome

承認された範囲を、提案、契約、実装、送信、デプロイなどの行動へ変え、成果物と結果を残します。

Executionが上流の判断や権限を勝手に書き換えることはできません。

### 5. Evaluation

結果を、あらかじめ決めた目的と評価基準へ照らします。

評価は判断の更新を提案できますが、必要な権限なしに正本を自動変更しません。

## nodeとedge

最初のnode型は意図的に小さく保ちます。

```text
observation
judgment
decision
resource
execution
outcome
evaluation
```

主なedgeは次のとおりです。

```text
depends_on
supports
contradicts
gates
supersedes
produces
evaluated_by
triggers
```

`depends_on`が実行順序を作ります。`supports`や`contradicts`は判断根拠の関係を表します。人物や組織の`member_of`、`owned_by`などの関係は、知識Graph側の意味として分離します。

## 重要なのは反証できること

AIが人間の考えに同意するだけでは、判断基盤になりません。

Judgment nodeでは、少なくとも次を確認します。

- この判断が失敗するとしたら、どの前提が誤っているか
- 反対案を最も強く説明するとどうなるか
- 見落としている関係者や損失はないか
- 判断基準同士が衝突していないか
- 新しい証拠が出た時に、何を見直すか

反証は人間の権限を奪うためではなく、承認前に判断の弱点を表へ出すために行います。

## personal・project・organizationは同じ構造

```text
scope:
  type: personal | project | organization
  id: <scope-id>
```

同じJudgment DAGを使い、scopeとauthorityを変えます。

個人の経験則をプロジェクト指針へ、さらに組織方針へ昇格する時は、証拠と承認を必要とします。LLMが同じ回答を繰り返しただけでは昇格しません。

## BrainbaseとManaの境界

Brainbaseは、判断グラフそのものを扱います。

- 何へ依存しているか
- 誰や何がrunnerになれるか
- どこまで権限があるか
- 何を出力したか
- どう評価されたか

Manaは、そのグラフをいつ動かすか、複数目標のどれを優先するか、仕事をどう追跡するかを扱います。

```text
Brainbase: executable organizational cognition
Mana: autonomous organizational operation
```

## 実装済みと構想を混ぜない

Judgment DAGの全構想が実装済みなわけではありません。

型検証とローカルrunnerは存在しますが、永続artifact store、replay、evaluation、human/agent governance、scope promotionには未実装または計画中の部分があります。

正確な境界は[現在の状態](/guide/status)を参照してください。
