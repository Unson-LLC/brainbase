---
spec_id: spec-company-os-subdag-v1
story_id: story-company-os-subdag-v1
status: accepted
---

# Company OS 下位判断 composition 仕様 v1

## 目的

親判断が、運用・技術・費用などの下位判断を同じ問題条件で呼び出し、下位判断の結論・根拠・適用範囲・不確実性・実行参照を辿れるようにする。

この仕様で追加するのは判断DAGの構成契約とcoordinatorだけである。既存の`JudgmentDAG`定義、単体`executeJudgmentDAG`、J0 run artifactの形式は変更しない。

## 分離する版と実行

`JudgmentDAGVersionReference`はDAGの`id`と`version`を指す。`JudgmentDAGCompositionDefinition`は親DAGにどの子DAGをどの順序で構成するかを、独立した`composition_id`と`composition_version`で表す。`JudgmentDAGCompositionRunRecord`は一回の実行を`run_id`で表す。

構成定義は生成時に完全検証し、実行記録にはそのID・版と子定義を固定して残す。ID・版の一意性を横断して管理するregistryはこの純粋なcoordinatorの外側に置き、registry上で構成を変える場合は新しい構成版として登録・再検証する。

## 子呼び出し契約

composition runは、任意の`fixed_conditions`だけでは開始できない。Story05で保存した
`JudgmentProblem`の`{snapshot_id, problem_id, revision}`を必須の
`problem_snapshot`として受け取り、親run・各子run・各子evaluation requestへ同じ参照を渡す。
`snapshot_reader`はその参照を使って現在の存在と読取権限を再確認し、同じ参照・
`judgment-problem-snapshot.v1`・`problem_id`・`revision`を持つsnapshotを返す。
snapshotの保存、ACL、証拠参照の解決はStory05のadapterが所有し、coordinatorはそのSSOTを
複製しない。読めない、参照が一致しない、revisionが違う場合はportを呼ばず
`snapshot_unavailable`で終了する。`fixed_conditions`はsnapshotの補助条件であり、
snapshot参照の代替ではない。

各子呼び出しは次を受け取る。

- 構成内の一意な`invocation_id`
- 子DAGのID・版と、子の入力・出力契約
- 子に渡す問い
- 親から固定された入力と固定条件
- 親runと同じ`problem_snapshot`参照
- 親の委任scopeとcapability集合のうち、子が要求する集合
- 先行する子の完了結果

子は次を返す。

- `completed`、`failed`、`held`の状態
- 結論
- 根拠参照
- 適用範囲
- 不確実性
- 実際に使った子DAGのID・版、子run ID、任意のJ0 artifact ID
- 入力・出力契約の実績

coordinatorは入力・固定条件・委任scope・依存結果をdeep freezeしてportへ渡し、返却値もJSON値としてsnapshotする。

実行開始前に`dag_resolver`で親・子のID・版を解決し、返されたID・版が定義と一致することを確認する。
子については返された入力・出力契約が定義と一致することを確認し、`contract_validator`へ渡す。
これらの事前検証が完了するまで、いずれのevaluation portも呼ばない。

## 検証と失敗時の扱い

- 子の要求capabilityは、親の委任capabilityのsubsetでなければならない。違反時はportを呼ばずに`capability_violation`で止める。
- 子のscopeは親のscopeと一致しなければならない。
- 子のDAG ID・版、入力契約、出力契約が定義と一致しなければ完了結果として採用しない。
- `dag_resolver`が欠落・不正・解決不能なら`dag_unavailable`、解決した版が定義と違えば
  `dag_mismatch`、契約validatorが拒否すれば`contract_mismatch`でportを呼ばずに終了する。
- 構成内の`depends_on`だけを実行依存としてtopological sortし、循環を拒否する。世界モデル内の関係や別のGraphの循環は、この実行DAGの循環とは扱わない。
- 子が`failed`または`held`なら、その子を含む親runは`completed`にならない。失敗・保留の子に依存する後続子は実行せず`held`として記録する。
- 独立した子は、別の子の失敗後も実行できる。ただし最終親状態は`failed`（失敗がある場合）または`held`（保留だけの場合）になる。

## 副作用境界

OSSのcoordinatorは任意のrunnerや資源・外部サービスを直接受け取らず、read/evaluationの結果を返す明示的な`JudgmentDAGSubDAGExecutionPort`だけを呼ぶ。capabilityはportへ注入する値としてsubset検証されるが、TypeScriptの任意callbackそのものをsandbox化する契約ではない。hostが任意コードをportへ渡した場合、その副作用や隔離はhostの責任であり、OSSは「拒否前にportを呼ばないこと」「渡す入力が固定されること」「結果を親成功へ丸めないこと」までを保証する。

したがって、資源確約・デプロイ・外部送信などの権限発行、プロセス隔離、secret管理はこのStoryの実装範囲に含めず、後続のexecution-authority / adapter側で扱う。

## J0 artifactとの関係

子runの参照は親子composition recordに保持するが、子のJ0 `JudgmentDAGRunRecord`をcomposition recordへコピーしない。子portが返す`artifact_id`は参照として保持でき、保存・再読込は既存artifact storeへ委譲する。既存artifactのキー、hash、検証規則、replay契約は変更しない。
子portが`artifact_id`を返す場合、`artifact_reader`を必須とする。readerは既存の
`loadJudgmentDAGRunArtifact`または同等の完全性検証済みreaderへ委譲し、coordinatorは
readback結果の`run_id`と`dag.id`・`dag.version`が子結果と一致することを確認する。
readerがない、読めない、identityが一致しない場合は`artifact_readback_failed`として
その子結果を親成功へ採用しない。artifact IDだけを証拠として扱わず、J0 APIの契約は変更しない。

## 受入条件と検証

1. 有効な親子構成のtopological order、problem snapshot参照、固定条件、委任subset、入力・出力・run参照をrecordで確認する。
2. snapshotの不存在・権限拒否・参照不一致、構成循環、重複・未解決dependency、scope・DAG版・契約不一致をfail closedする。
3. snapshot・DAG版・入出力契約の事前検証がportより先に実行され、capability違反時もportが呼ばれないことを確認する。
4. artifact IDを返す子でreadbackを要求し、run/dag identity不一致を`artifact_readback_failed`にすることを確認する。
5. 子の`failed` / `held`と依存先のheld伝播が親`completed`へ丸められないことを確認する。
6. child resultと入力がcaller mutationから独立し、parent/child recordがdeep freezeされることを確認する。
7. `judgment-dag`既存テストとJ0 artifactテストを変更なしで通過させる。

## 非目標

任意コードworkflow engine、host callbackのsandbox、Graph/DBへの永続化、組織の認可規則、資源予約、外部作用、全DAGの五層強制は含めない。
