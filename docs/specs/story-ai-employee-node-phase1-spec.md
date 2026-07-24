# Story: AI employee node Phase 1

Status: proposed

## Outcome

Unson Slackの1チャンネルで、1人格・1ワーカーのAI社員ノードを
`draft_only` で運用し、タスク結果と判断委任の証拠をBrainbaseへ戻す。
OpenRyokoは交換可能なgateway、Lightsailは交換可能なruntimeであり、
Mana LambdaとGraph SSOTを変更しない。

## Non-goals

- Manaの置換、M系ジョブ本体の移植
- 複数workspace、複数persona、`sshHost`、Docker分離
- `approval_required` または `auto_execute` への昇格
- OpenRyokoのtodo、memory、org、approval機能を正本にすること
- Agent SDK課金経路を使うremote worker

## Source identities

- `run_receipt.v1 source.type=openryoko` を追加する契約変更は、このStoryの
  runtime connector実装と同じ変更で行う。
- `source.workflow_id=slack:<workspace_id>:<channel_id>` または
  `cron:<stable_job_id>`。
- `run.external_run_id` はOpenRyokoの安定したsession/run識別子を使う。
  識別子が取得できない観測を成功runとして捏造しない。
- receiptにはprompt、response本文、transcript、raw log、Slack本文、
  customer textを含めない。証拠はsource-owned opaque referenceまたは
  credentialを含まないHTTPS URLに限定する。

## Scenarios

- S-001: allowlist外ユーザー、DM、MPIM、非pilot channelからのdriveを拒否する。
- S-002: pilot channelのメンションから複数ターンタスクを完遂し、Graph SSOTの
  read evidenceを参照する。
- S-003: Graph write、email send、任意Slack send、deploy、purchase、任意の外部
  network writeをtool実行前に拒否し、必要ならdraft/human stepへ変換する。
- S-004: terminal taskとcron runをdurable outboxへatomic enqueueし、
  Brainbase `/api/run-receipts/ingest` へ冪等配送する。
- S-005: Brainbase停止中もsource runの成否を書き換えずoutboxを保持し、
  bounded retry後はdead letterとして可視化する。
- S-006: draftを提示した時は `ai_drafted`、人間が採択・編集・無視したことを
  観測できた時だけ対応するDecision Eventを送る。未観測を採択として扱わない。
- S-007: systemd再起動後にgatewayとreceipt deliveryが復帰する。
- S-008: 4 GB instanceのRSS、CPU、OOM、rate-limitを週次評価へ記録し、
  取得不能値は `未確認` とする。

## Acceptance criteria

1. `ADR-020` がacceptedになり、fork/upstreamとauthority boundaryがレビュー済み。
2. OpenRyoko forkのpinが再構築手順に記録され、upstream追従テストがある。
3. unrestricted `--dangerously-skip-permissions` に依存せず、S-003のnegative
   testsが実環境で再生される。
4. mention/cronのsuccess、failed、blocked、waiting_human、cancelledが
   `run_receipt.v1`へ正しく写り、duplicate再送で二重記録されない。
5. receiptに禁止本文やcredentialが含まれないcontract testが通る。
6. Decision Eventは既存8種を再利用し、0件・収集不能を成功率0%や100%にしない。
7. reboot後にSlack task、Graph read、receipt deliveryの3点が再確認される。
8. Mana Lambdaおよび`bb.unson.jp`既存Lightsailへの変更がdiff・運用証拠ともにない。

## Evaluation record

Phase 1の運用指標の正本はBrainbaseのRun Receipt/Decision Eventとする。
NocoDBの手入力表は移行期間の補助記録に限定し、同じ指標の二重正本にしない。

- task completion rate: terminal mention receiptsのsuccess割合
- human interventions: human step / waiting_human evidence
- cron availability: stable cron workflowごとのterminal receipt
- proposal adoption: `ai_drafted` に対する `draft_accepted` / `draft_edited`
- rate-limit collision: blocked/failed receiptのredacted category
- resource headroom: node-local observationから週次に集約したRSS/CPU/OOM

分母またはsource evidenceがない期間は `未確認` と表示する。

## Delivery slices

1. **Architecture gate:** ADR、fork、upstream/pin policy、脅威モデル。
2. **Capability gate:** `draft_only` enforcementとnegative tests。
3. **Receipt connector:** `source.type=openryoko`、durable outbox、Brainbase ingest。
4. **Decision measurement:** draft/disposition event wiring。
5. **Pilot proof:** reboot、Graph read、cron、2〜4週間の週次集計。

Slice 1だけではpilot completeではない。Slice 2を通るまで既存インスタンスは
technical spikeとして扱い、権限・channel・credentialを拡張しない。

