---
story_id: story-personal-human-decision-answer-web-v1
title: ローカルWebで人に戻した判断へ正式に回答し、条件を確認して作業を再開できる
status: draft
created_at: 2026-10-02
implementation_started: false
owner_repository: brainbase
depends_on:
  - story-personal-value-proof-review-v1
  - story-personal-value-proof-review-web-v1
external_dependencies: []
---

# ローカルWebで人に戻した判断へ正式に回答し、条件を確認して作業を再開できる

## 設計状態

これは D-20261002-04 で承認された「人に戻した判断の正式回答・作業再開」の**設計案だけ**を記録する draft Story である。受入済みの仕様、実装開始、API・保存先・本番変更を意味しない。Story と Spec の判断が確定し、別の実装・検証変更が承認されるまで、画面にも動作にも未定義の回答経路を追加しない。

## 利用者成果

単独所有者として、Brainbase が自分に戻した判断について、何を問われたか、なぜ自分の判断が必要か、どの仕事に結び付くかを確認したうえで、正式な回答を一度だけ記録したい。回答が正本へ読み戻され、元の問いと同じものだと確認できたときだけ、既存 Host の権限境界の中で、明示的に作業の再開を依頼したい。拒否・取り消し・読取り不能・問いの差替えは、再開済みや成功と表示されてはならない。

## 正本・所有と対象

- 実装・登録 repo は OSS `Unson-LLC/brainbase`、対象は単独所有者の loopback Web と既存 Judgment Host である。
- 回答の正本は、既存の value-proof 本体を上書きせず、回答を一つの canonical record として読み戻せる後続契約を持つ必要がある。正本のファイル、sidecar、journal のどれを採用するかは未決定であり、この Story は保存先を確定しない。
- Web の launch token・同一オリジン・loopback は Host の境界であって、人そのものの本人確認を既に証明する契約ではない。本人確認の強さは別途決定する。
- 組織、複数メンバー、外部ログイン、Mana の外部実行、Graph の判断基準改訂、外部操作の自動取消しは対象に含めない。

## 現状と根拠

現行コード・契約から確認できるのは「問いを保存して表示し、実行後の評価を別に追記する」までであり、正式回答の受付・保存・再開は未実装である。

- `JudgmentValueProof` は `intent_id`、`decision_attempt_id`、`state`、`interruption`、`human_decision`、`feedback` を持つが、`human_decision` は `question`、`why_human`、`options` のみで、回答・回答者・回答状態・再開参照を持たない（`src/judgment-value-proof.ts:97-138`）。
- `human_required` は `human_decision` の存在と問い・理由・選択肢を検証するだけで、回答を検証しない（`src/judgment-value-proof.ts:215-244`）。Schema も同じ範囲である（`contracts/judgment-value-proof/schema.json:114-146`）。
- 現行レビューは `human_required` を「あなたの判断が必要」に分類し、journal が利用不可なら `unavailable` として返す。無い記録を 0 件に丸めない（`src/judgment-value-proof-review.ts:194-248`）。
- 現行の契約 fixture は `continued_without_human` で `human_decision=null` であり（`contracts/judgment-value-proof/fixture.json:1-53`）、`human_required` のレビュー fixture では `question_display_text`／`question_digest` と `human_decision.question`／`why_human`／`options` を別々に保持している（`tests/judgment-value-proof-review.test.ts:47-65`）。回答設計はこの実データ形状を前提にし、未保存の回答フィールドを既存記録へ補って表示しない。
- 既存 feedback は `intent_id` と `decision_attempt_id` を持つ別の JSONL に追記し、journal 本体は変更しない。同じ評価の再送信は同じ ID を返すが、回答の正本や再開許可ではない（`src/judgment-value-proof-review.ts:294-379`）。
- HTTP は現在 `/home` の読取りと `/feedback` の評価 POST だけを公開し、評価 POST は同一オリジン、起動 token、journal 内の既知 ID を要求する（`src/value-proof-review-http.ts:73-139`）。回答 route は存在しない。
- Host は `session_ref`、`turn_id`、episode、tool event、final receipt、continuation を相互に束縛するが、`JudgmentFinalReceipt.answer_digest` は最終 assistant 本文の digest であって、人の判断回答ではない（`src/judgment-host.ts:169-230`、`src/judgment-host.ts:1814-1925`）。
- Receipt には「判断 receipt は write や外部 action を認可しない」というポリシーがある。正式回答を受けても、Host の権限・承認・対象状態の再確認を省略できない（`src/judgment-host.ts:850-924`）。

## 代替解釈と反証

「回答」を何とみなすかはまだ一意に決まっていない。次の候補を残し、実装に先立つ親判断にする。

| 候補 | 回答の意味 | 利点 | 反証・不足 |
| --- | --- | --- | --- |
| A | 同じ `session_ref`・`turn_id` の待機中 episode へ返す | 現行 Host の episode binding と近く、同じ仕事を再開しやすい | ブラウザを後から開くと元 session/turn が無い、または既に final になっている可能性がある |
| B | 元の `intent_id`・`decision_attempt_id`・問い digest を参照する新しい continuation turn として返す | 別プロセス・別ブラウザでも履歴を結び付けやすい | 新しい turn の正本、Host の再評価、二重実行防止を別契約にする必要がある |
| C | 回答を正本へ記録するだけで、作業再開は別の明示操作・別契約にする | 回答保存と実行権限を最も分離できる | 利用者は別操作を理解する必要があり、再開までの UX が長くなる |
| D | 既存の `feedback` を回答として扱う | 既存画面を変更しなくてよい | feedback は実行後の振り返りであり、PR #640 の境界文言とも、既存 status とも矛盾する。正式回答には採用しない |

この Story は B と C を組み合わせる案（回答の記録と、別の明示的な再開 handshake）を安全側の候補として扱うが、A/B/C の採択はしていない。

## 受入条件案（実装着手前）

- [ ] AC-01: 回答入口は、正しく検証された `state=waiting_human` かつ `interruption.resolution=human_required` の記録だけに表示する。`human_decision` が欠ける、不正な、問い digest が確認できない、journal が利用不可の記録は回答可能な件数や空状態に変換しない。
- [ ] AC-02: 回答前に、問い、問いの表示文、本人に戻した理由、選択肢と影響、`intent_id`・`decision_attempt_id`、記録時点、現在の実行状態を同じカードで確認できる。`question_display_text` と `human_decision.question` が食い違う場合は回答を止め、どちらかを推測しない。
- [ ] AC-03: 回答は、元の ID と問いの digest、本人確認の証拠、選択肢または自由記述の回答、受付日時、回答状態を含む一つの canonical record として保存・読み戻しできる。既存 `.value-proof.json`、判断 episode、final receipt を上書きして回答を「実行済み」にしない。
- [ ] AC-04: loopback、Host 検査、同一オリジン、launch token は既存の local Web 境界として維持する。これだけで本人確認済みと主張せず、回答を許可する owner confirmation（採択する方法は未決定）を記録する。別 owner、別 origin、token 欠落・不一致は保存しない。
- [ ] AC-05: 回答は少なくとも `intent_id`、`decision_attempt_id`、既存の `interruption.question_digest`（または親判断で定めた同等の immutable question binding）に完全一致して紐付く。digest が無い旧記録や、現在表示している問いと digest が一致しない記録は、回答ではなく「確認待ち」と表示する。
- [ ] AC-06: 同じ canonical answer payload の再送信は同じ answer identity と読み戻しを返し、一件を増やさない。同じ attempt に異なる回答を送る競合は拒否し、既存回答を上書きしない。同時送信は Host 側の lock/CAS で一件に直列化し、ブラウザの二重クリック・通信 retry・再読込みを二重実行にしない。
- [ ] AC-07: 「拒否」は問いへの正式な回答として記録するが、作業再開を許可しない。拒否理由を必須にするか、選択肢の一種にするかは未決定である。「回答しない」「後で決める」と拒否を混同しない。
- [ ] AC-08: 「取り消し」は保存済み回答を消去・上書きせず、元の answer identity を参照する新しい無効化記録として扱う。取り消し後は再開を拒否する。既に起きた外部操作や保存済み成果を自動で巻き戻したとは表示せず、必要なら別の照合・回復契約へ渡す。
- [ ] AC-09: 再開は回答保存の副作用にせず、読み戻し後の明示操作に分ける。再開前に、現在の canonical answer、元の問い digest、owner confirmation、元 episode/新 continuation の binding、実行権限、既存 final/resume の有無を Host が再確認する。Receipt やブラウザの成功表示だけで作業や外部作用を始めない。
- [ ] AC-10: 元の判断が既に final、再開済み、拒否、取り消し、期限切れ、問い差替え、未確認のいずれかなら、再開を拒否するか確認待ちとして表示する。回答が保存できても読み戻し・Host handshake・後続成果が未確認なら、回答済み／再開済み／成果確認済みを兼ねた表示にしない。
- [ ] AC-11: journal、answer record、Host が不正・欠落・部分読取り・競合を返したときは、理由と次の安全な操作を示し、0 件・成功・不在・外部操作完了へ丸めない。送信前の入力は再試行できるよう保持する。
- [ ] AC-12: 既存 feedback は実行後の `採用`・`訂正`・`次回は聞く`・`取り消し` という振り返りであり、正式回答・承認・再開の substitute にしない。回答画面で feedback の保存先や status を流用しない。
- [ ] AC-13: PR #640 で確認できる「この画面では、人に戻した判断への回答や作業の再開はできない」「評価は実行後の振り返り」「Codex 相談はコピーのみ」という文言は、既存 review UI の境界表示として維持する。今回の設計はその文言だけから route、保存、再開を実装済みとは推測しない。

## 既存 feedback との境界

既存 feedback は、実行後の判断を本人が振り返り、次回の委任範囲や判断方法を訂正するための別レイヤーである。`judgment-value-proof-feedback.jsonl` は value-proof 本体を変更せずに追記され、最新値は `human_feedback` evidence ref として projection に反映される。一方、正式回答は「まだ実行されていない問いに対して本人が何を選ぶか」を記録し、再開可否に影響する。この二つは次を共有しない。

- answer の正本・idempotency key・owner confirmation を feedback ID や status から導出しない。
- `feedback.reverted` は振り返り上の「取り消し」であり、外部操作の rollback ではない。回答の revocation と同じ意味にしない。
- answer 保存が成功しても feedback が記録された、または逆だと推測しない。両方が必要な後続フローは、別々に読み戻す。

## PR #640 の文言のみとの境界

この worktree の `origin/develop` には回答 route は無く、ローカルで確認できる `19b902b2d7be58d26a3870741d375ebb7414f31c`（コミットメッセージ「回答と評価の境界を見返し画面に表示」）は、review UI とその Story に境界文言・回帰テストを追加した変更である。委任で示された PR #640 の remote 状態そのものはこの作業で照合していないため、PR 番号と remote の全差分は未確認として扱う。

この Story が PR #640 の文言から引き継ぐのは、次の境界だけである。

1. 既存 review 画面は回答・再開を提供しない。
2. feedback は実行後の振り返りで、回答・承認ではない。
3. 「Codex で相談する」は依頼文のコピーだけで、送信ではない。

回答フォーム、canonical answer record、本人確認、再開 handshake、外部操作は PR #640 の実装済み成果に数えない。

## 対象外

- 既存 `human_decision` の schema、TypeScript 型、journal、HTTP route、UI の実装変更。
- canonical answer の具体的なファイル名、API path、HTTP method、DB、Graph entity、外部サービス。
- 外部ログイン・複数 owner・組織承認・Mana の実行／照合、外部送信、成果の自動 rollback。
- Personal KG の検索結果を本人の代理回答・再開権限として扱うこと。現行 Host にもその自動代理ループは組み込まれていない。
- 回答を保存しただけで、Host の process、tool、delivery、Receipt、外部成果、readback を完了とすること。

## 未確定事項と親の判断待ち

次のいずれかを判断台帳・親の設計レビューで確定するまで、実装開始しない。

1. 回答を同じ turn に返すか、新しい continuation turn に紐付けるか（A/B/C）。
2. 回答の canonical record と既存 value-proof／judgment journal の関係、immutable append と current projection の境界。
3. `question_digest` が無い旧記録を回答可能にする移行・再記録の方法（推測で digest を作らない）。
4. launch token と `self` owner principal だけで十分か、追加の owner confirmation を要求するか。
5. 回答 payload（選択肢のみ、自由記述、両方）、拒否理由、期限切れ、取り消し後の再回答可否。
6. 回答受付と再開を二段階にするか、再開 handshake の Host 所有者・権限・結果契約をどう定めるか。
7. 既存 episode が final／欠落／競合の場合の再開先、元 turn と新 turn の重複防止、外部作用後の照合責任。

## 検証計画（実装後の案）

実装を始める場合も、まず fixture と fake local root で契約を検証し、本番や外部送信は行わない。

- **正本と問い**: valid `human_required` fixture、`question_digest` 欠落、`question_display_text` と `human_decision.question` の差替え、`intent_id`／`decision_attempt_id` 取り違え、malformed journal を個別に検証する。
- **本人確認と境界**: loopback、Host/port、Origin、token、owner confirmation の各欠落を一つずつ拒否し、既存 value-proof と feedback が変更されないことを確認する。
- **二重送信**: 同一 payload の retry、異なる回答の競合、並行 POST、取り消し後の再送信を lock/CAS と読み戻しで確認する。
- **拒否・取り消し**: reject は再開不可、revocation は元回答を残して再開不可、外部操作の rollback を主張しないことを確認する。
- **再開**: answer readback → 明示的 resume handshake → Host の episode/continuation binding → process/tool/final の順に確認し、各段階を別の結果として記録する。Host receipt、HTTP 2xx、プロセス起動だけを成果成功としない。
- **利用者表示**: unavailable、unconfirmed、stale、conflict、saved-but-not-resumed を 0 件・成功・不在にしない。既存 PR #640 の境界文言と feedback の説明が消えないことを回帰確認する。

## 根拠参照

- `src/judgment-value-proof.ts:97-138,215-244`
- `contracts/judgment-value-proof/schema.json:1-18,21-38,114-146`
- `src/judgment-value-proof-review.ts:194-248,294-379,381-403`
- `src/value-proof-review-http.ts:28-139`
- `src/local-web-security.ts:44-55,88-95`
- `src/local-web-host.ts:64-69,98-108,148-167`
- `src/judgment-host.ts:145-230,544-565,653-703,850-941,1396-1451,1549-1610,1814-1925`
- `docs/stories/story-personal-value-proof-review-web-v1.md:25-43`
- ローカルで確認した commit `19b902b2d7be58d26a3870741d375ebb7414f31c`（PR #640 の remote 状態は未確認）

## この Story の完了条件

Story と対応 Spec の設計レビュー、未確定事項の判断、実装・検証の別 Story への分離が完了した時点を設計完了とする。コード変更、API 公開、保存、作業再開、外部成果の確認は、この draft Story の完了を意味しない。
