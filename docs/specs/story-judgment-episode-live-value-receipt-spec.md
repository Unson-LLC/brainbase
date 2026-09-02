# Spec: 新規Codex委任タスクの判断価値レシート

## 状態

Accepted。正本Storyは`docs/management/stories/active/story-judgment-episode-live-value-receipt.md`、共通lifecycle契約は`docs/specs/story-brainbase-judgment-resolver-v1.md`とする。

## 契約

- 通常turnは`UserPromptSubmit`で開始し、episodeへ`episode_origin=user_prompt_submit`、`route_application=pre_generation`を記録する。
- episodeがないCodex App委任turnだけ、最初の`Stop`で現在turnの正規`codex_delegation`を復元できる。
- 復元は`namespace=codex_app`、toolが`create_thread`または`send_message_to_thread`、完全な包み、現在turn、候補1件、現在session aliasと連結するsession componentだけに限定する。
- transcriptに別session componentが混在する場合は、候補の内容に関係なくfail-closedとする。
- Stop時のepisode復元は、最初の回答が確認質問か完了報告かに依存しない。復元後にHostが回答本文と実行状態を評価し、不要質問の差し戻し、未完了作業の継続、正常完了をそれぞれ既存契約で判定する。
- 復元episodeは`episode_origin=stop_delegation_recovery`、`route_application=post_generation_recovery`を記録し、final receiptへ同じ値を束縛する。
- 復元routeは最初のStopと後続処理だけを支配する。すでに生成された初回回答を事前に導いたとは主張しない。
- 実際に不要質問を差し戻し、同一episodeの実行証拠、canonical readback、value proof、completed stateが揃った場合だけ最終判断レシートを表示する。
- canonical readbackが欠けるvalue proofは`unconfirmed`のまま保存し、利用者には`Brainbase判断結果（確認待ち）`と警告を表示する。これは最終判断レシートでも成果確認済みの主張でもない。
- 共通Resolverは、禁止節の位置や言語にかかわらず禁止された操作を分類対象から除外し、同じ入力中の肯定されたローカル操作だけを保持する。肯定操作の判定語彙は`judgment-runtime-manifest.json`の`positive_commands`を正本とし、禁止だけの入力を`write`または`external`へ昇格しない。

## 受け入れ基準と証拠

| AC | 実装 | 自動検証 |
|---|---|---|
| AC-001 | Stop時の委任episode復元とlifecycle marker | unitの委任復元、entrypoint integration |
| AC-002 | tool、turn、包み、候補数、session componentの限定 | unitの拒否ケースと混在session回帰テスト |
| AC-003 | 復元不能時は既存orphan監査へ収束 | unitの別tool・別turn・別session・壊れた包み・複数候補拒否、integrationの`judgment_episode_not_found`契約 |
| AC-004 | continuation、value proof、final renderer | entrypoint integrationの同一episode完全経路 |
| AC-005 | 通常開始、通常続行、人間判断、既存final、結果未確認のlifecycle整合検証 | Host unit/integrationの通常開始・pending/completed・waiting_human・orphan・unconfirmed経路 |
| AC-006 | 自動テスト、型検査、fresh task/journal readback | 現HEADのunit・Host entrypoint integration・型検査と、本番反映後のfresh Codex task出力・同一episode journal readback |

fresh task証拠が揃う前は、AC-006とStory全体を完了扱いしない。
