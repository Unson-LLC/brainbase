# Architecture: Codex App Judgment Episode Entrypoint

## 責務境界

- Codex Host adapterは、通常turnでは`UserPromptSubmit` payloadを使う。Codex App委任turnでそのeventが欠けた場合だけ、Stop payloadの`transcript_path`から現在turnの正規`codex_delegation`入力を復元する。
- Judgment Resolver Hostは、正規化後の入力だけからepisodeを開始し、route receiptと後続Tool/Stop eventを同じ識別子へ束縛する。
- 判断価値ProjectionとRendererは既存契約を利用し、このStoryでは複製・緩和しない。
- fresh taskの依頼分類は共通Resolverを通る。禁止された操作を肯定要求へ反転せず、同じ文の前後にある肯定されたローカル操作だけを分類へ残す。肯定操作の語彙は`judgment-runtime-manifest.json`の`positive_commands`を正本とし、前処理内へ別の固定語彙を持たない。

## データ経路

1. 通常turnではUserPromptSubmitでepisodeを開始する。
2. Stopでepisodeがない場合、許可されたCodex App委任出力と現在turnの一致を検証する。
3. 一致が一意なら、回答が確認質問か完了報告かにかかわらず、委任入力をpromptとして同じsession/turnのjournalへinitial route receiptを原子的に保存し、`episode_origin=stop_delegation_recovery`と`route_application=post_generation_recovery`を記録する。
4. 同じStopで不要確認と未完了作業を評価し、必要なら回答を差し戻す。
5. 継続後のPostToolUseとStopが同じcanonical identifierでepisodeを取得する。Desktopの実行証拠は`thread_items`をsession、turn、tool useの3識別子で照合し、完了済みfileChangeまたは単一readだけを安全な参照へ変換する。
6. 実際の中断差し戻しとvalue proofが揃った場合だけ判断レシートを組み立てる。`PostToolUse`はcompleted stateを記録するだけで、後続`Stop`が最終assistant回答の監査ブロックを検証して確定する。

## 真実性境界

- Stop時に候補episodeを推測して別turnへ結び付けない。
- 復元元は`namespace=codex_app`かつ`create_thread`／`send_message_to_thread`の完全な`codex_delegation`包みに限定する。
- 同じturnに復元候補が複数ある場合は採用しない。
- transcriptに現在session aliasと連結しない別session componentが一つでも含まれる場合は、候補を採用しない。
- session/turnが欠ける入力を固定値や最新episodeへ丸めない。
- Stop復元routeは差し戻しと後続処理だけに適用し、初回model生成を導いた証拠として表示・監査しない。通常の`UserPromptSubmit`開始は`pre_generation`として区別する。
- episode復元自体は回答形式に依存させない。質問の有無は復元後のAutonomy Gateが判定し、質問がなく成果未確認の場合はfinal receiptへ昇格させない。
- canonical readbackが欠けるprojectionは`unconfirmed`として監査保存し、利用者面では`Brainbase判断結果（確認待ち）`と表示する。`Brainbase判断レシート`は成果確認済みの場合にだけ使う。
- Desktop履歴の別session、別turn、別tool use、未完了item、複数対象readは証拠へ採用しない。履歴DBが読めない場合も従来のPostToolUse契約へ縮退し、成果確認済みを捏造しない。
- state PostToolUseは、差し戻し後の状態が`completed`であることをjournalへ記録するだけで、finalを自動確定しない。runtime 2.4 continuationを含む全経路で、後続Stopが実回答の監査ブロックを検証した場合だけcompleteにする。
- `judgment_episode_not_found`を成功へ変換せず、入口で開始できなかった理由を監査可能にする。
- fresh task実証はunit/integrationの合格と分け、実際のCodex task出力とjournal readbackの両方で確認する。
- 禁止節の除外は句順に依存させない。日本語・英語とも「肯定依頼→禁止」「禁止→肯定依頼」「禁止だけ」を回帰fixtureに固定し、作成・削除・マージを含むManifest語彙の増減と前処理を同じテストで拘束する。

## 検証方針

- Unit: Codex Appの実rollout形状をfixture化し、正規委任だけを復元して異常入力を拒否できる。
- Unit: 確認質問を含まない最初のStopでも正規委任episodeは復元するが、証拠不足を最終判断レシートへ昇格しない。
- Integration: 実Hook wrapper経由で不要確認のStop差し戻し、実行証拠、最後の`completed` state PostToolUse、最終Stop、`owner_audit_source=assistant_answer`、正確な回答digestまでを同じepisodeで完了する。
- Unit: Desktop履歴のfileChangeと単一readを厳密な3識別子で結合し、completed state PostToolUseを成果確認済みの状態証拠として記録できる。
- Resolver unit: 日英の禁止節を前後どちらに置いても、肯定されたローカル書込みだけが`implement/write`となり、禁止だけの文は操作要求にならない。
- E2E: 新規Codexタスクで不要な確認が差し戻され、成果物完了後に`Brainbase判断レシート`が1回表示される。
