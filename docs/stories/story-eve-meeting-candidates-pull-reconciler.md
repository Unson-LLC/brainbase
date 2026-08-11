---
story_id: story-eve-meeting-candidates-pull-reconciler
title: meeting packのtask/decision/follow-up候補をEve(LLM)由来にする（pull型reconciler相乗り）
status: active
created_at: 2026-07-12
updated_at: 2026-07-13
---

# meeting packのtask/decision/follow-up候補をEve(LLM)由来にする（pull型reconciler相乗り）

## 背景

meeting pack の task候補・decision候補・follow-up候補は現在、ingest時に決定的関数だけで生成されている（`server/services/meeting-source/meeting-source-mcp-sync-service.js` の `buildTaskCandidatesFromTranscript` / `buildDecisionCandidatesFromTranscript` / `buildFollowUpDraft`）。中身は `sentenceCandidatesFromTranscript` = `。！？`改行で文分割し cue語（対応/確認/決定…）を含む文を最大5個拾う正規表現抽出で、誰が/何を/期限の合成・重複排除・文脈理解ができない。

構造化JSON形式のtranscript会議（`msrc_4f7c995f`「07-11 New PMS/STAYE」）では、決定的splitterがJSONを文分割できず候補titleに生JSONが露出している。平文transcriptの他会議も「キーワードを含む文」を拾っているだけで実タスクとしては低品質。

議事録本文は既に、`story-eve-meeting-note-pull-reconciler` で敷いた pull型reconciler（`server/services/external-runner/eve-meeting-note-reconciler.js`）が Eveセッションstreamから `record_meeting_note_generation` の tool-call input を抽出し、ローカル `recordNoteGeneration` で `meeting_note_draft` output を `brainbase_source_ready → brainbase_generated` に更新する形で稼働している。Eve の meeting-agent は既に同一セッションで task/decision/follow-up 候補を生成しているが、書き戻しtoolのスキーマが `note:{title,body}` しか持たないためLLM生成候補は捨てられている。

## 誰が

meeting pack の task/decision/follow-up 候補を承認・実行に使う運用者、およびその候補品質に依存する開発者として。

## 何を

task/decision/follow-up 候補を、ingest時の決定的splitterではなく、議事録生成と同一のEveセッションで生成されたLLM候補から得たい。全5 output は同一 ingest run 上に作られるので、既存の pull型reconciler が議事録本文を書き戻すのと同じ session stream pull パスで、候補も sibling output に書き戻せるようにする。決定的splitterは廃し、Eve未達時は候補を空（awaiting-Eve）として扱う。

## なぜ

CLAUDE.md原則「抽出・分類・要約・ドラフトはLLM、決定的判断はコード」に反し、正規表現の文分割では実タスク候補を作れず、構造化transcriptでは生JSONが表に露出してしまう。生成はLLM（Eve）に寄せ、id付与・重複排除防止・approval gate・source_text_hash検証といった決定的判断はBrainbase側コードに残すことで、候補品質と監査整合の両方を満たす。

## 受け入れシナリオ

### S-001: noteと候補が同一セッションで返る

- Given: ingest runにawaiting-Eveの候補outputがあり、Eve sessionがnoteと候補のtool-callを返す
- When: pull reconcilerがsession streamを処理する
- Then: noteと候補を同一runへ書き戻し、候補をBrainbase側で正規化してdispatch runをsuccessで閉じる

### S-002: noteだけで終了したセッション

- Given: Eve sessionが正しいnoteを返した一方、候補tool-callを返さず終了している
- When: pull reconcilerがsession streamを処理する
- Then: noteを主ゲートとしてdispatch runをsuccessで閉じ、候補outputはawaiting-Eveのまま保持する

### S-003: noteの後に候補が遅延する

- Given: Eve sessionが正しいnoteを返した一方、候補tool-callがまだなくsessionが進行中である
- When: pull reconcilerがsession streamを処理する
- Then: dispatch runをrunningのまま保持し、次回pollで候補を再取得する

### S-004: 一致する候補の書き込みが失敗する

- Given: source_text_hashが一致する候補tool-callがあり、Brainbaseの候補書き込みが例外になる
- When: 終了済みsessionをpull reconcilerが処理する
- Then: 生成済みnoteは保持し、dispatch runをblockedかつhuman_waitingとしてoperator_review_eve_candidatesを要求する

### S-005: 担当者hintが一意に解決できる

- Given: Eve task候補のowner_hintがPeople SSOT上の人物に一意に一致する
- When: Brainbaseが候補を正規化する
- Then: 一致した人物をselected_ownerとowner_candidatesの第1候補に設定する

### S-006: 担当者hintが曖昧である

- Given: Eve task候補のowner_hintにPeople SSOT上の候補が複数一致し、project contextでも安全な第1候補を一意に決められない
- When: Brainbaseが候補を正規化する
- Then: owner_candidatesは保持するがselected_ownerは設定せず、owner_resolutionをambiguousとして保存する

## Workflow State Scenarios

- S-001 `workflow state transition`: waiting runでnoteと候補が揃うと、両方を書き戻してdispatch runをsuccessへ閉じる。
- S-002 `workflow state transition`: 終了済みEve sessionがnoteだけを返した場合、候補をawaiting-Eveに保ったままnote主ゲートでsuccessへ閉じる。
- S-003 `workflow state transition`: 進行中Eve sessionでnoteだけが先着した場合、dispatch runをrunningに保って次回pollへ進む。
- S-004 `workflow state transition`: 終了済みEve sessionの一致候補を書き込めない場合、noteを保持しつつblockedかつhuman_waitingへ遷移する。
- S-005 `workflow state transition`: owner_hintがPeople SSOT上で一意の場合、正本人物をselected_ownerと第1候補へ設定する。
- S-006 `workflow state transition`: owner_hintがPeople SSOT上で複数一致しproject contextでも第1候補を決めきれない場合、候補を保持しつつselected_ownerを未設定に保つ。

## Scenario Clauses

- SCN-001: S-001のsuccess pathで、同一sessionのnoteと候補が同一ingest runへ保存される。
- SCN-002: S-002のnote-only pathで、候補不在をmeeting note成功の失敗条件にしない。
- SCN-003: S-003のasync retry pathで、進行中sessionを早期closeせず再pollする。
- SCN-004: S-004のwrite failure pathで、operator actionと監査状態を失わない。
- SCN-005: S-005のunique owner pathで、People SSOTの一意人物を既定担当者にする。
- SCN-006: S-006のambiguous owner pathで、AIが根拠なく担当者を選択しない。

## Failure Modes

- FM-001 `parse_failure`: workflow APIの不正JSONは候補outputを書き換える前に拒否する。
- FM-002 `retry_or_async_failure`: 進行中sessionの候補遅延または一時的な書き込み失敗はrunningのまま次回pollへ渡す。
- FM-003 `evidence_lifecycle_regression`: 終了済みsessionの一致候補を書き込めない場合はsuccessに閉じず、operator action付きblockedとして証跡を残す。
- FM-004 `source_mismatch`: 異なる`source_text_hash`の候補は同一runへ混入させない。
- FM-005 `network_runtime`: Eve session streamの取得失敗はrunをrunningのまま自動再試行し、直近エラー・失敗回数・復旧時刻をworkflow metadata、Mission Control、audit logへ残す。
- FM-006 `bounded_external_input`: task/decision候補は各最大5件とし、候補フィールドまたはfollow-up本文がBrainbaseの受入上限を超えるpayloadは、候補outputとauditを一切変更せず全体を拒否する。

## Production Path Matrix

| Path | Trigger | Required behavior |
| --- | --- | --- |
| success | noteと一致候補が同一sessionに揃う | noteと候補を保存しsuccessへ閉じる |
| note_only | 終了済みsessionがnoteだけを返す | noteを保存し候補はawaiting-Eveのままsuccessへ閉じる |
| delayed_async | 進行中sessionで候補が未到着 | runningを維持して再pollする |
| candidate_write_failure | 終了済みsessionの一致候補を書き込めない | blockedかつhuman_waitingにしoperator actionを要求する |
| session_stream_failure | Eve session streamを取得できない | runningを維持し、再試行状態とエラーをoperatorへ表示する |
| owner_unique | owner_hintがPeople SSOTで一意 | selected_ownerと第1候補を設定する |
| owner_ambiguous | owner_hintがPeople SSOTで複数一致しproject contextでも一意に順位付けできない | owner_candidatesを保持しselected_ownerは設定しない |
| oversized_payload | 候補件数または文字列長がBrainbaseの受入上限を超える | owner解決や書き込み前に全体を拒否し、既存outputとauditを保持する |

## Flow Replay Evidence

- `flow_replay`: session stream pull、候補書き戻し、note主ゲート、再poll、stream障害からの復旧、operator blockをunit/integration/Playwright contractで再生する。
- `artifact_replay`: `source_text_hash`、candidate metadata、audit action、dispatch stateを同一run上で検証する。
- `scenario_clause_e2e`: S-001からS-006とSCN-001からSCN-006を `tests/e2e/story-eve-meeting-candidates-pull-reconciler-owner-ssot.spec.ts` およびreconciler integration testsへ対応させる。
- `production_path_matrix`: success、note-only、delayed async、session stream failure、candidate write failure、unique owner、ambiguous ownerを現HEAD証跡へ記録する。

## Current Reality

- ingest時の決定的splitterは構造化transcriptのJSONを候補titleへ露出させ、Eveが同一sessionで生成済みの候補をBrainbaseへ保存していなかった。
- Mac CompanionはBrainbase payloadの`selected_owner`を既定担当者として表示できるが、Eve候補経路がPeople SSOT解決を通らないため未設定になっていた。
- note先着時や候補書き込み例外時の状態遷移が曖昧で、候補証跡を失ったままsuccessに閉じる経路があった。
- Eve session streamの取得失敗は一時summaryとserver logにしか残らず、通常のMission Controlから停止理由を確認できなかった。

## Done Evidence

- Unit: Eve reconcilerのsuccess、note-only、delayed retry、stream read failure/recovery、write failure block、ambiguous ownerを検証する。
- Integration: Eve session client、reconciler、workflow APIの115 testでparse、retry、evidence lifecycleを検証する。
- E2E: Story固有Playwrightでnote-only、遅延retry、stream read error、write failure block、hash、org/project/run scope、raw JSON非露出、一意・曖昧担当者を検証し、Mission Controlのrun traceでreconciliation理由、poll error、scope mismatch件数、operator action、担当者既定値が見えることまで確認する。
- Static: `npm run typecheck`を現HEADで通す。
- Release: Eveのproducerを先にVercel productionへ反映し、Brainbase consumer PRを後にマージする。consumerはLightsail `brainbase-nocodb` の`brainbase-ssot.service`（`/home/ubuntu/brainbase`、port 55123）へ反映し、対象ingest runだけを限定再dispatchして候補書き戻しを確認する。

## Engineering Judgment Spine

current_reality: BrainbaseのEve pull reconcilerとMeeting Review Packageは既に存在するが、候補だけは決定的splitter由来で、Eve候補のPeople SSOT解決・遅延再取得・書き込み失敗証跡とstream取得失敗のoperator表示が欠けている。

failure_modes: 不正JSON、source hash不一致、session stream取得失敗、active sessionでの候補遅延、終了済みsessionでの候補書き込み失敗、People SSOTの曖昧一致を明示的な再試行または人間判断待ちとして扱う。

done_evidence: 最終HEADに固定したunit、integration、typecheck、Story Playwright、owner SSOT regressionと、VibeProのAC・Scenario・flow replay証跡が全て通る。

release_or_operation: Eve producerを先にVercelへ、Brainbase consumerを後にLightsailへ反映する。operatorは`--run-id`で対象を1件に限定し、workflow metadataとaudit actionを確認する。問題時は退避したLightsail branchへ切り戻してserviceを再起動し、正本ではconsumer merge commitをrevertする。不可逆migrationはない。

## Acceptance Criteria

- [ ] AC-001 / ac:1: Eveが同一セッションで `record_meeting_candidates` を呼ぶと、reconcilerがその tool-call input を抽出し、`source_text_hash` を `meeting_note_draft` output と突合の上、同一 ingest run の `task_candidates` / `decision_candidates` / `follow_up_draft` output を更新する
- [ ] AC-002 / ac:2: 候補の件数とテキスト長をBrainbase側で検証し、上限超過payloadは全体をatomicに拒否する。受理した候補のid付与・status・source・evidence_refs・follow_upのexternal_send承認フラグは決定的に正規化し、approval gate（`approve_task_candidates` 等）を維持する
- [ ] AC-003 / ac:3: Eve候補handoffは`org_id` / `project_id` / `run_id` / `source_text_hash`を必須とし、不一致の候補書き戻しを除外して件数をMission Controlに表示する
- [ ] AC-004 / ac:4: 議事録の close 判定は従来どおり note を主ゲートに保ち、候補が不在でも note で close する（候補は best-effort）
- [ ] AC-005 / ac:5: ingest時の決定的splitter（`buildTaskCandidatesFromTranscript` 等）を廃し、候補 output は非null awaiting-Eveプレースホルダで作られる
- [ ] AC-006 / ac:6: 構造化JSON transcript の会議でも、候補 output の payload/preview に生JSONが露出しない
- [ ] AC-007 / ac:7: Eveのtask候補に `owner_hint` がある場合はPeople SSOTで担当者候補を解決し、安全に一意特定できた人物を `selected_owner` と第1候補へ設定する。曖昧・未解決なら未設定を維持する
- [ ] AC-008 / ac:8: VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- 既存18件のうち生JSON露出の `msrc_4f7c995f` 1件のみ検証的に再dispatchする。残り17件の bulk backfill は rate limit スロットリング必須のためデプロイ後の別運用ステップ（runbook）に切り出す。
- 候補専用 loop intent（`meeting_note_to_tasks` / `meeting_note_to_decisions` / `post_meeting_follow_up_message`）の独立dispatch化。今回は議事録と同一セッションへの相乗りとし、独立dispatchはしない。
- blocked dispatch run の sweep-close 改善（既知の低優先事項）。
- Eve側の候補生成プロンプト品質チューニング（instructionsに書き戻し手順を足すのみ）。

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
