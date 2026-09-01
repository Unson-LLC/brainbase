# Architecture: Judgment Value Proof Consumer

## 責務境界

- `Unson-LLC/brainbase`: 公開Schema、構造上の真実性検証、表示モード、チャネル非依存Rendererの正本。
- `Unson-LLC/brainbase-unson`: 組織版MCP入力、既存Judgment Episode eventへの接続、Host journal固有の`subject_ref`・event順序・digestの意味検証、Projection生成、Codex Stopへの表示接続。
- 各Surface: Slack、Mana、Web固有の描画。今回の対象外。

## データ経路

1. Hostが不要な質問を差し戻した時点で、質問文とdigestをimmutableな中断候補として記録する。`human_required`では、最終回答の確認行を中断候補にする。
2. モデルがその中断を解決した場合だけ、`brainbase_judgment_value_proof_record`を正確に1回呼ぶ。
3. `PostToolUse` journalへ安全な構造化metadataを記録する。
4. Stopで同一episodeの中断候補、証拠event、実行状態を照合し、Core Schemaへ投影する。
5. Core validationを通過したProjectionだけをimmutable receiptとして保存する。
6. Core Rendererの出力を既存監査ブロックの後へ追加する。

## 真実性境界

- tool入力だけでは`outcome_verified`にしない。同一episodeのverified evidenceが必要。各成果物には、その成果物と同じ`subject_ref`を`artifact_refs`に持つ成功した実行eventと、同じ`subject_ref`を入力にした結果ありの`search`または`retrieve`成功eventを要求する。さらに、`executionSequence < readbackSequence < valueProofSequence`の順序を満たし、読み戻しの入出力digestを証拠refへ束縛する。読み戻しだけ、別成果物の実行、実行前の古い読み戻し、無関係な取得、結果なし、書込み成功の自己申告では検証済みにしない。
- 質問削減は、同一turnでHostが実際に差し戻した質問とvalue proof入力が完全一致する場合だけ表現する。
- `human_required`は完了へ丸めず、`waiting_human`状態と表示質問の完全一致を必須にする。
- 成功したvalue proof eventは同一episodeに正確に1件だけ許可し、複数件は曖昧な最新採用をせず失敗させる。
- 入力が無いturnはレシートを生成しない。
- raw tool response、秘密情報、内部監査ログは表示Projectionへ入れない。
- attention付随成果物はfinal receiptのdigestへ束縛し、再Stopで欠落または改ざんを検出する。
- runtime 2.4で必要なknowledge/stateが揃いHost監査行だけが欠けた場合は、CodexのStop再入に依存せず、初回StopのHost出力で監査行を補完してfinal receiptを確定する。状態や実行契約の不一致は補完対象にしない。

## P0で検証済みにできる実行経路

- P0では、Hostが安全に成果物参照を抽出できる`apply_patch`の`Add File`と`Update File`だけを、実行eventの`artifact_refs`へ束縛する。
- shellによるファイル生成、Brainbase write、その他の非Brainbase実行はeventが成功しても、成果物参照を安全に確定できないため`outcome_verified`へ昇格させず`unconfirmed`にする。
- これらの経路を追加対応するときは、経路ごとの安全な成果物抽出と、別成果物・読み戻しだけ・逆順を拒否する負例テストを同時に追加する。

## 展開境界

- `BRAINBASE_JUDGMENT_VALUE_PROOF_MODE`の既定値は`off`。
- `enabled`は明示的な全体有効化、`canary`は`BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS`のproject codeだけを対象にする。
- PRのマージだけでは本番表示を有効化しない。fresh-task実証後にcanaryを広げる。
