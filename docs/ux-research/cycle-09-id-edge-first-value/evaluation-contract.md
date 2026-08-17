# cycle-09 正規ID接続による初回価値 評価契約

## 北極星

初見の利用者が公開Brainbaseの取得を始めてから10分以内に、実Codexが本人承認済みの文脈をBrainbase MCPから取得し、正規エンティティ同士のID接続を根拠として現実の依頼へ有用な回答を返す。利用者が「Brainbaseはこう使える」と価値を認識できる状態を北極星とする。

これはCLIコマンド単体の応答時間ではない。取得開始から、インストール、最小文脈の保存、実MCP接続、実Codexによる文脈再利用、有用な結果の確認までを一つのジャーニーとして測る。予算は600,000msとする。各コマンドの所要時間は診断用に別記録する。

## 今回の価値仮説

利用者が一度保存した「Atlas導入」「田中」「実測と利用者成果を分ける」という前提を説明し直さなくても、実Codexが次を行えるなら初回価値がある。

1. `resolve_entity`で文章中の「田中さん」と「Atlas導入」を正規エンティティへ解決する。
2. `get_context`と`search`で保存済みの人物、Project、判断基準を取得する。
3. `canonicalEntityId`と`relationPath`から、人物・Project・判断基準がIDで接続されていることを根拠として示す。
4. `recordClass`により正規エンティティと互換投影を区別し、投影を正本として扱わない。
5. 取得した根拠を、田中さんへ相談する具体的な判断メモへ再利用する。

単なる設定完了、exit 0、CLIの固定サンプル、一般的な回答は価値達成に含めない。

## 実行面

- 候補版: 生成したローカルtarballを隔離consumerへ導入し、`candidate-corpus/`へ記録する。
- 公開版: npm registryからfresh installし、`registry-corpus/`へ記録する。
- 両者を同じmanifestや同じ結果ファイルへ混在させない。
- Cycle 08の固定証拠は変更しない。

## 必須ジャーニー

1. 隔離consumerへ指定packageを実際にインストールする。
2. 公開CLIの`onboard:start`が表示した`onboard:seed`をそのまま実行する。
3. `doctor`でローカルGraphと実エージェント接続状態を分けて確認する。
4. 実Codexへ、隔離された`brainbase-mcp`とPersonal OSの場所を設定する。
5. 実Codexが`resolve_entity`、`get_context`、`search`を実際に呼ぶ。
6. 実Codexの回答に、Atlas導入、田中、判断基準、正規ID、関係経路、正本と投影の区別、未確認事項、次の行動が含まれる。
7. 32の独立した合成ペルソナが、固定された同一証拠から価値認識を判定する。

## 合成ペルソナの価値判定

各ペルソナは、次を必ず記録する。

- `status`: `recognized | not_recognized | uncertain | not_executed`
- `value_moment_ref`: 価値を認識した正確なtraceと回答箇所
- `value_reason`: 自分の目的に対する具体的な差分
- `counterfactual_without_product`: Brainbaseなしで必要だった再説明、探索、照合
- `reuse_intent`: `yes | no | uncertain`
- `confidence`: `low | medium | high`
- `journey_duration_ms`と`within_budget`
- `missing_condition`: 認識できない場合の不足条件

合成ペルソナは固定証拠から自分の状況をシミュレーションし、価値瞬間、製品なしとの差分、再利用意思を判断する。ペルソナ本人が端末を操作したとは表現しない。

## ハードゲート

1. 未設定、MCP未検証、部分取得、曖昧、未解決を成功や0件へ丸めない。
2. 各失敗状態に、実行可能な次操作または復旧操作がある。
3. 表示した必須コマンドを同じ隔離環境で実行している。
4. 既存データを暗黙に削除せず、再実行が冪等である。
5. 初回価値が設定状態ではなく、実Codexの具体的な回答本文にある。
6. 利用者向けの主要説明が理解可能な日本語である。
7. 敬称付き検索が同じ正規IDへ解決し、曖昧時は自動昇格しない。
8. 正規エンティティ、投影、未解決を機械可読に区別する。
9. Relation Registryに従ったID経路を返し、文字列の同名一致を関係根拠にしない。

## 収束条件

最新ラウンドで、32ペルソナすべてが必須タスクを完了し、全ハードゲートを通過し、価値認識が`recognized`かつ10分以内で、今回対象の既知Majorは0件でなければならない。

既知Majorとは「Atlas導入と判断基準の明示的なID接続不足」「正規エンティティと投影の区別不足」「敬称付き人物名の検索正規化不足」を指す。1件でも残れば収束しない。

## 証拠境界

- 合成ペルソナの結果は`synthetic_persona_value_recognition`として扱う。
- 実在利用者の観察は`human_observation`であり、未収集なら`not_collected`とする。
- 人間32人が価値を感じた、実機や支援技術で確認した、公開npm版で確認した、とは各証拠がない限り表現しない。
- 候補tarballの成功を、公開registry版の成功へ昇格しない。
