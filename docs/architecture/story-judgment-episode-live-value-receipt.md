# Architecture: Codex App Judgment Episode Entrypoint

## 責務境界

- Codex Host adapterは、通常turnでは`UserPromptSubmit` payloadを使う。Codex App委任turnでそのeventが欠けた場合だけ、Stop payloadの`transcript_path`から現在turnの正規`codex_delegation`入力を復元する。
- Judgment Resolver Hostは、正規化後の入力だけからepisodeを開始し、route receiptと後続Tool/Stop eventを同じ識別子へ束縛する。
- 判断価値ProjectionとRendererは既存契約を利用し、このStoryでは複製・緩和しない。
- fresh taskの依頼分類は共通Resolverを通る。禁止された操作を肯定要求へ反転せず、同じ文の前後にある肯定されたローカル操作だけを分類へ残す。肯定操作の語彙は`judgment-runtime-manifest.json`の`positive_commands`を正本とし、前処理内へ別の固定語彙を持たない。

## データ経路

1. 通常turnではUserPromptSubmitでepisodeを開始する。
2. Stopでepisodeがない場合、許可されたCodex App委任出力と現在turnの一致を検証する。
3. 一致が一意なら委任入力をpromptとして同じsession/turnのjournalへinitial route receiptを原子的に保存し、`episode_origin=stop_delegation_recovery`と`route_application=post_generation_recovery`を記録する。
4. 同じStopで不要確認と未完了作業を評価し、必要なら回答を差し戻す。
5. 継続後のPostToolUseとStopが同じcanonical identifierでepisodeを取得する。
6. 実際の中断差し戻しとvalue proofが揃った場合だけ判断レシートを描画する。

## 真実性境界

- Stop時に候補episodeを推測して別turnへ結び付けない。
- 復元元は`namespace=codex_app`かつ`create_thread`／`send_message_to_thread`の完全な`codex_delegation`包みに限定する。
- 同じturnに復元候補が複数ある場合は採用しない。
- transcriptに現在session aliasと連結しない別session componentが一つでも含まれる場合は、候補を採用しない。
- session/turnが欠ける入力を固定値や最新episodeへ丸めない。
- Stop復元routeは差し戻しと後続処理だけに適用し、初回model生成を導いた証拠として表示・監査しない。通常の`UserPromptSubmit`開始は`pre_generation`として区別する。
- `judgment_episode_not_found`を成功へ変換せず、入口で開始できなかった理由を監査可能にする。
- fresh task実証はunit/integrationの合格と分け、実際のCodex task出力とjournal readbackの両方で確認する。
- 禁止節の除外は句順に依存させない。日本語・英語とも「肯定依頼→禁止」「禁止→肯定依頼」「禁止だけ」を回帰fixtureに固定し、作成・削除・マージを含むManifest語彙の増減と前処理を同じテストで拘束する。

## 検証方針

- Unit: Codex Appの実rollout形状をfixture化し、正規委任だけを復元して異常入力を拒否できる。
- Integration: UserPromptSubmitなしのStopが同じepisodeを開始し、不要確認の差し戻しから実行証拠、value proof、最終判断レシートまで同じepisodeで完了できる。
- Resolver unit: 日英の禁止節を前後どちらに置いても、肯定されたローカル書込みだけが`implement/write`となり、禁止だけの文は操作要求にならない。
- E2E: 新規Codexタスクで不要な確認が差し戻され、成果物完了後に`Brainbase判断レシート`が1回表示される。
