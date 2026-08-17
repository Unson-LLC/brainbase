# cycle-08 ペルソナ価値認識 評価契約

## 北極星

初見の利用者が公開Brainbaseを取得して使い始めてから10分以内に、実際の対象エージェントが本人承認済みの文脈を使って現実の依頼へ有用な回答を返し、利用者が「Brainbaseはこう使える」と価値を認識できる。

これはCLIコマンド単体の応答時間ではない。取得開始から、設定、文脈保存、実エージェント利用、有用な結果の確認までを一つの候補ジャーニーとして測る。

## 今回の検証

1. npm公開版を隔離環境へ実際にインストールする。
2. 公開CLIが表示した最小文脈保存コマンドを実行する。
3. MCP設定を隔離した実Codexへ適用する。
4. 実CodexからBrainbase MCPの`get_context`と`search`を呼ぶ。
5. 保存文脈を使った現実の判断メモを取得する。
6. オントロジー管理者向けに、保存済み文脈のエンティティ・関係・知識種別を点検し、断絶や表記ゆれと正規化案を取得する。
7. 32の独立した合成ペルソナが、同じ固定証拠から「自分なら価値を認識するか」を判定する。

候補ジャーニーの予算は600,000msとする。

## 価値認識の必須判定

各ペルソナは次を必ず記録する。

- `status`: `recognized | not_recognized | uncertain | not_executed`
- `value_moment_ref`: 価値を認識した、または認識できなかった正確な証拠参照
- `value_reason`: そのペルソナにとって有用な差分
- `counterfactual_without_product`: Brainbaseなしなら必要だった作業
- `reuse_intent`: `yes | no | uncertain`
- `confidence`: `low | medium | high`
- `journey_duration_ms`と`within_budget`
- `missing_condition`: 認識できない場合に不足した条件

`recognized`には、10分以内であること、実MCP利用、具体的な回答本文、本人の状況に即した差分が必要。終了コード、成功表示、一般的な称賛だけでは認めない。

## 証拠境界

- 合成ペルソナの価値認識は、合成評価として集計する。
- 「32人の利用者が価値を感じた」とは表現しない。
- 実在利用者の観察は別の`human_observation`であり、未収集なら`not_collected`とする。
- 音声入力、スクリーンリーダー、実機支援技術は、実行証拠がなければ未収集とする。
- 公開npm版とローカルtarballを区別する。

### 合成評価の採点規則

- `human_observation`、実機、音声入力、支援技術が未収集であることだけを理由に、合成ペルソナの`value_simulation.status`を`uncertain`または`not_recognized`にしてはならない。これらは`missing_condition`と証拠境界へ残す。
- 固定された実行証拠の中に具体的な価値瞬間があり、自分の目的との差分、製品なしの場合の手間、再利用意思、10分予算内を説明できれば`recognized`と判定する。
- `uncertain`または`not_recognized`は、価値瞬間が不明、本人の目的に結び付かない、製品なしとの差分が説明できない、再利用意思がない・不明、または予算超過の場合に限る。

## 収束条件

最新ラウンドで、32ペルソナすべてが必須タスクを完了し、6つのハードゲートが通過し、価値認識が`recognized`かつ10分以内で、新規Majorが3件未満なら収束できる。1件でも`not_recognized`、`uncertain`、`not_executed`があれば価値認識では収束しない。
