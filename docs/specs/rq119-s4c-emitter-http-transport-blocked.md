# RQ-119 S4c（judgment outbox → 組織版受け取り口への HTTP 送り手）: 前提未成立により停止

- 台帳要件: **RQ-119**
- 設計: brainbase#878（マージ想定コミット `729f4248`、`docs/specs/rq119-worker-judgment-emission-design.md`）
- 対象ブランチ: `queue/9TSojsbc`（base: `develop`）
- 判定日: 2026-10-28

## やろうとしたこと（S4c の読み）

設計 §9 に「S4c」という名前は無い。この依頼では、S4（組織版の受け取り口への送出）のうち **brainbase 側の部分** を S4c とし、
S1 が定義する transport port（差し込み口）を満たす **HTTP の送り手** を実装する、という読みで進める予定だった。

- 送り先 URL と資格は呼び出し側から差し込む（設定・環境変数の名前だけ決め、値は持たない）。案A: agent credential で送る。owner の JWT は使わない。
- 冪等: 記録の ID（`resolution_id`）をそのまま送り、409 は受領済みとして扱う。
- 403（資格無効）等の失敗では outbox 記録を消さず、理由だけ返す。理由に資格値や token を含めない。
- タイムアウト・ネットワーク失敗でも記録を残す。
- 偽の受け取り口を使う単体テスト（成功・409・403・タイムアウト・不正応答）を追加。

（この S4c の読みは Director に確認中。）

## 前提の確認結果 — **未成立のため停止**

依頼の最初の指示: 「origin/develop に S1 の送り出し（`src/worker-judgment-emitter.ts` と transport port）が入っているか確かめる。入っていなければ PR は作らず、何が無いかを書いて止める。」

`origin/develop`（tip `d046d096`）に対して確認した結果、**S1 も RQ-119 設計も develop に入っていない**。

| 確認対象 | develop での有無 |
| --- | --- |
| `src/worker-judgment-emitter.ts`（送り手本体・transport port 定義） | ✗ 無し |
| `src/worker-judgment-emit-cli.ts` | ✗ 無し |
| `tests/worker-judgment-emitter.test.ts` | ✗ 無し |
| `docs/specs/rq119-worker-judgment-emission-design.md`（設計 #878） | ✗ 無し |
| S1 コミット `2e1187dc` / `0185be8d` が develop の祖先か | ✗ いずれも非祖先 |
| 設計マージ `729f4248` が develop の祖先か | ✗ 非祖先 |

S1 の実体は未マージの `queue/s2s8gZ6A-prev-20261026212205` にのみ存在する。
依頼の前提どおり、S1（キュー `s2s8gZ6A`）は 2026-10-27 時点でレビュー FAIL（P1 2件）、S4a（`yCr2fwHw`）も FAIL、S4b は未登録。

## なぜ今は作れないか

S4c は、S1 が公開する transport port を実装する adapter である。
S1 がまだ develop に無いため、S4c が実装すべき契約（port のインターフェース）の正本が develop 上に存在しない。
未マージ・レビュー FAIL の S1 定義に対して adapter を書くと、S1 が P1 指摘の修正で変わった場合に契約がずれる。
依頼自身が「前提が無いときは止めた理由の報告」を完了条件としているため、PR は作らず停止する。

参考として、S1 が develop に入った後に S4c が満たすべき port（`queue/s2s8gZ6A-prev-20261026212205:src/worker-judgment-emitter.ts` 時点）:

```ts
export interface WorkerJudgmentTransportResult {
  readonly status: 'saved' | 'already_saved' | 'failed' | 'blocked_credential';
  readonly reason_code?: string;
}
export interface WorkerJudgmentTransport {
  send(envelope: WorkerJudgmentEnvelope): Promise<WorkerJudgmentTransportResult>;
}
```

HTTP 送り手は `WorkerJudgmentTransport` を実装し、`envelope.resolution_id` を冪等キーに、
409→`already_saved`、403→`blocked_credential`（理由コードのみ、資格値は含めない）、
timeout/ネットワーク失敗→`failed` を返す形になる想定。ただしこれは S1 確定後に実装する。

## 再開の条件

1. S1（`s2s8gZ6A`）のレビュー P1 2件が解消され、`src/worker-judgment-emitter.ts` と transport port が `develop` にマージされること。
2. （望ましくは）RQ-119 設計 #878 も `develop` にマージされ、§9 に対する S4c の読みが Director により確定すること。
3. 再開時に S4c（HTTP transport adapter）と偽受け取り口を使う単体テストを実装し、`npm ci` 後にテストを通し、codex 読み取り専用レビュー PASS の上で develop 向け **Draft PR** を作成する。

## 止めたところ

- 実装・テスト追加は行っていない（前提未成立のため）。
- PR は作成していない。push もしていない。
- 本レポートのみを `queue/9TSojsbc` にコミットする。

## 根拠

- Director 2026-10-27 09:10 JST の依頼（要件の巡回、キュー登録後に進める）。
- 開発は本番キューを通す方針である。
- 前提が届いていない。本件は前提未成立のため、実装・PR・npm 公開のいずれにも進まない。
