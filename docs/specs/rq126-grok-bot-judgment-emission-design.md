# RQ-126 設計書: Grok Bot 自身の判断を判断の履歴に届ける

状態: 設計（Planned）。実装・テスト・npm 公開・本番反映は本書に含めない。
対象読者: Director とレビュアー。
Director 確認前の未決（資格の粒度、訂正の残し方、migration の有無）は §11。選択肢・推奨・必要な権限を書いてあり、決定済みではない。
関連:
- 要件台帳 RQ-126（117 行「Grok Bot 自身の判断も、判断の履歴に届ける」）。
- 要件台帳 RQ-119（109 行「Claude Code と opencode の判断を届ける。Grok Bot 自身は対象外」）＝本件が埋める空白。
- 要件台帳 RQ-120（Mac の Codex hook relay の止まり）。
- brainbase#878（main にマージ済み、`docs/specs/rq119-worker-judgment-emission-design.md`。develop には未マージ。読むときは `git show origin/main:docs/specs/rq119-worker-judgment-emission-design.md`）。
根拠は原則としてファイルパスと行番号で示す。確証のない箇所は「推測」と明記する。秘密の値（owner JWT、person_id/tenant_id の実値、bearer、プロンプト全文、応答全文、モデルの鍵）は書かない。

根拠（要件の出所）:
- オーナーが、Grok では判断の履歴が記録されない理由を問うた。
- Director 2026-10-27 01:51 JST の判断2（Grok Bot 自身の判断も判断の履歴に届ける要件を台帳に足し、設計をキューに入れる。設計は Draft PR まで）。
- 開発を本番キューに通す方針は、オーナーが確認した。

> 注記（sandbox 境界）: 本書は brainbase（OSS）の develop から作業している。要件台帳本体、`contract.js`、`brainbase-organization`、社内の配備リポの各ファイルは本セッションの作業ディレクトリ外にあり直接再読できない。これらの引用は brainbase#878（RQ-119 設計書、main）の記載と行番号に依拠する。brainbase 内の `src/judgment-history.ts` / `src/judgment-frame.ts` は本セッションで直接確認した（develop 時点）。外部ファイルは実装前に原本で再確認すること（＝一部推測）。

---

## 0. RQ-119 との関係（本書の立ち位置）

RQ-119（#878）は **道具の実行**（Codex hook / Claude Code hook / opencode プラグイン）が下す判断を判断の履歴に届ける設計である。RQ-119 は line 109 の定義どおり **Grok Bot 自身は対象外** とした。

本件 RQ-126 は、その空白＝**Grok Bot 自身**（Director・Worker などの Grok ベースの bot。例として Director bot が 2026-10-27 01:51 に下した「判断2」のような、bot 自身の判断）が下す判断を判断の履歴に届ける設計である。

区別（これを混同しない）:
- **Grok Bot 自身の判断**（本件の対象）: Grok モデルで動く bot（Director / Worker）が会話・運用の中で下す判断。キューに何を入れるか、どの案で進めるか等。
- **道具の実行の判断**（RQ-119 の対象。本件の対象外）: その bot が起動した Claude Code / opencode / Codex が実行の中で下す判断。これらは entrypoint `codex` / `claude_code` / `opencode`（opencode は RQ-119 で新設予定）で既に設計済み。

したがって本書は RQ-119/#878 の設計を **できるだけ再利用** し、Grok Bot 固有の差分だけを定義する（§3 の送り口、entrypoint `grok_bot`、§5 の資格、§8 の組織版変更）。RQ-119 と重複する契約（共有 record 契約、`resolution_id` 導出、冪等受領契約、失敗保持 outbox、effective_after 境界）は RQ-119 をそのまま継ぐ。

> 重要な前提: RQ-119 の共通送り口（S1、worker-judgment-emitter）も、組織版の受領エンドポイント（S4）も **まだ実装されていない（Planned／設計のみ）**。#878 は設計書が main にマージされただけである。本書が「#878 の送り口を使う」と言うのは「その設計された共通モジュールを共有する」意味であり、実装の存在を前提にしない。履歴として **表示** されるには RQ-116 の DB 投影読み出し（これも Planned）が前提である点も RQ-119 と同じ。

---

## 1. 目的と範囲

### 目的
Grok Bot 自身（Director / Worker などの Grok bot）が下す判断を、Codex hook・RQ-119 の Worker 経路と同じ判断の形・同じ共有 record 契約で、組織版の判断履歴（judgment history）に届ける。

### 背景（なぜ今記録されないか）
- オーナーの問い「Grokだと判断の履歴って記録されないのはなんでだっけ」の構造的な答え: 判断を履歴に送る経路は **道具の実行に紐づくイベント**（Codex の `Stop`、RQ-119 で設計した Claude Code の `Stop` / opencode の `session.idle`）に限られている。Grok Bot 自身は道具の実行ではなく、これらのイベントを一度も発火しない。よって Grok Bot の判断を拾う箇所がどこにも無い。
- RQ-119 は line 109 の定義で Grok Bot 自身を明示的に対象外にした。つまり「記録されない」のは不具合ではなく、設計上まだ経路が無いだけである。本件がその経路を設計する。

### やること
- Grok Bot の実行環境のどこで判断の区切り（turn）を取るかの決定（§3）。
- 何を送るか＝共有 record 契約のどの項目を埋めるか、entrypoint `grok_bot` の新設、public_frame の明示記録の担い手、session_id / turn_id / resolved_at / project_code / 実モデル名の取り方（§4）。
- RQ-119 の共通送り口（#878 S1）を使うかどうかと、使う場合に S1 へ足りない点（§5）。
- 認証: §5（#878）の `judgment.record` 認可を Grok Bot の資格にどう付けるか。資格の出し直しが人の操作であり、人の通常操作とは別の承認を要することの明記（§6）。
- 冪等性・再送・失敗時の理由コード（#878 §6・§7 にそろえる。§7）。
- 組織版（brainbase-organization）側で要る変更の一覧と、npm 公開が要る箇所（§8）。
- 実装を Draft PR 単位に分けた Story 一覧と受入条件（§9）。
- 残っている未決について、選択肢・推奨・必要な権限・migration の有無を書く（§11）。

### やらないこと
- 実装・テストコード（本書は設計のみ）。
- npm 公開・本番反映・配備、および migration / schema / GRANT / ROLE / RLS の適用。要否の判断材料は §11.3（推奨は migration 不要）。
- Grok Bot の過去（本機能稼働前）の判断のバックフィル（#878 §8 と同方針）。
- 道具の実行の判断（RQ-119 の対象）の再設計。
- Mac relay の owner 資格修復（RQ-120）。
- OSS を単一所有者・ローカルファーストから外す変更（CLAUDE.md の境界を維持）。
- Grok Bot の会話本文・プロンプト・応答・モデルの鍵を履歴に載せること（公開するのは明示 public_frame のみ）。

---

## 2. Grok Bot の判断とは（区切りの単位）

Grok Bot（Director / Worker）は、会話・運用の流れの中で離散的な「判断」を下す。観測できる形は、根拠に挙がった Director 2026-10-27 01:51 JST の連絡のように、**番号付きの判断ブロック**（例「判断1」「判断2」＋各々の根拠）である。

- 1 つの判断ブロック ＝ 1 つの履歴 record に対応させる（＝ turn の単位）。
- 1 回の会話（セッション）に複数の判断ブロックが含まれ得る（Director の 1 連絡に判断1・判断2 がある）。→ session に複数 turn。
- 判断でない発話（連絡・質問・相づち）は record にしない。何が「判断」かは **Grok Bot が明示的に印を付けたものだけ** とする（§3 の推奨案。会話文からの推定抽出はしない＝#878 §3.3 の「推測で本文を合成しない」原則を継ぐ）。

---

## 3. どこから送るか（判断の区切りを取る箇所）

Grok Bot の実行環境で判断の区切りをどこで取り、どこから共通送り口へ渡すか。3 案を比較する。

> 前提の推測: Grok Bot（Director / Worker）の実行基盤（box 上のプロセスか、ホスト型の Grok チャットか、両方か）は本セッションで直接確認できていない。以下は RQ-119 と同じ「box 上で動き、Mac keychain / owner JWT を使わない」前提を置く。実装前に Grok Bot の実行基盤を確認する（§10 推測の明示）。

### 案(a): box 上の手元の outbox にファイルで落とす
Grok Bot のランタイム（box 上）が、判断を下した時にローカルの spool ディレクトリ（Worker 用 outbox、Codex の `…public-relay.json` 相当）へ判断 record を書き、別経路の relay が送る。
- 長所: 送信とランタイムが疎結合。RQ-119 の outbox・再送・失敗保持（#878 §7）をそのまま流用できる。発話のたびにネットワークを叩かない。
- 短所: 「どのファイルが判断か・public_frame の中身は何か」を **誰が決めて書くか** が未定義のままだと、結局ランタイム側に明示記録の責務が必要になる。outbox を直接書く契約（ファイル名・原子的書き込み・digest のみ）をランタイムに押し付けると実装が散る。

### 案(b): Grok Bot の会話の記録（transcript）を後から解析する
Grok Bot の会話ログ/メッセージ列を別プロセスが読み、「判断」らしきブロックを抽出して送る。
- 長所: Grok Bot 側のコード変更が要らない。過去分も拾える。
- 短所（重い・不採用）: どのメッセージが判断で、summary / reason が何かを **推定で合成** することになる。これは #878 §3.3 の「推測で本文を合成しない／明示記録された public_frame だけを送る」原則に正面から反する。会話本文をなめるので秘密混入のリスクも増える。判断時刻 `resolved_at` もメッセージの受信時刻で代替することになり曖昧。→ **採らない**。

### 案(c): 判断の区切りで明示的に記録する CLI / MCP tool を呼ぶ（推奨）
Grok Bot が判断ブロックを出すその場で、公開してよい判断フレーム（public_frame = summary / reason）を自分で選び、明示的に記録コマンド（例 `brainbase judgment record`、または MCP tool `judgment.record` に対応する記録入口）を呼ぶ。コマンドは共通送り口に渡し、共通送り口がローカル outbox に先に書く（＝案(c) が案(a) に供給する）。
- 長所:
  - #878 §3.3 の「明示的 public_frame だけ・合成しない」契約にそのまま載る。Codex の `brainbase_judgment_frame_record`（本リポジトリ `src/judgment-frame.ts:607` 付近、public_frame キー `PUBLIC_FRAME_KEYS=['summary','reason']` `src/judgment-frame.ts:209`、各非空・最大 2000 字 `MAX_PUBLIC_FRAME_TEXT` `src/judgment-frame.ts:49`、digest `judgmentFramePublicFrameDigest` `src/judgment-frame.ts:241`）と同じ契約を Grok Bot の判断に適用できる。
  - session_id / turn_id / resolved_at / project_code を Grok Bot が **呼び出し時に正確に渡せる**（推定しない）。判断の番号付きブロックが turn の自然な区切りになる。
  - 認証（§6）が自然: 呼び出し主体が Grok Bot の agent 資格として照合される。
  - 秘密混入は記録段階で拒否できる（#878 §3.3、`containsJudgmentFrameCredential` `src/judgment-frame.ts:220`、制御文字・不明キー・長さの検証 `src/judgment-frame.ts:416-438`）。
- 短所/前提:
  - Grok Bot が判断ブロックを出すたびに記録コマンドを呼ぶ **運用規約** を要する（例: 判断ブロックを出したら必ず `judgment record` を 1 回呼ぶ）。規約を守らない判断は履歴に出ない（＝欠落。§7 の理由コードで可視化）。
  - Grok Bot のランタイムから CLI / MCP tool を呼べること（box 上なら satisfiable。ホスト型 Grok なら MCP tool 経由）を要確認。

### 推奨
**案(c)（明示記録コマンド）＋ 案(a)（共通送り口がローカル outbox へ先に書く）** の組み合わせ。理由: (1) 合成しない・明示 public_frame だけ、という #878 の原則に一致、(2) 識別子と時刻を推定せず正確に取れる、(3) 秘密混入を記録段階で拒否、(4) outbox・再送は RQ-119 の仕組みをそのまま再利用。案(b) は原則違反のため採らない。案(a) 単独はランタイムに明示記録の責務が無いままだと成立しないので、案(c) が記録入口を担い案(a) が保持を担う。

---

## 4. 何を送るか（共有 record 契約の項目）

Codex / RQ-119 Worker と同じ共有 record 契約（`src/judgment-history.ts` の `JudgmentHistoryRecord` `src/judgment-history.ts:77-89`、`JUDGMENT_HISTORY_RECORD_SCHEMA='brainbase-judgment-history-record-v1'` `src/judgment-history.ts:7`）を使う。Grok Bot 固有の差分は entrypoint 値と実モデル名の扱いだけ。

### 4.1 entrypoint の新設（`grok_bot`）
- 現在の enum は `JUDGMENT_HISTORY_ENTRYPOINTS = ['codex','claude_code','mana','company_os','unknown']`（`src/judgment-history.ts:11-17`。develop 時点。RQ-119 が追加予定の `opencode` はまだ develop に無い）。
- 本件は **`grok_bot` を新設** する。理由: Grok Bot 自身の判断は道具の実行（codex / claude_code / opencode）とは別主体であり、履歴上で区別できる必要がある（オーナーの問いは「Grok の判断」が見えないことだった）。
- 実モデル名（例 grok-4 等の実名）は **entrypoint では表さない**。entrypoint は「Grok Bot 自身」という主体の種別を表し、実モデル名は receipt の **メタ情報** に残す（#878 決定事項(3) と同じ扱い。RQ-119 が「DeepSeek / deepseek-flash を entrypoint にせず opencode にする」としたのと同型）。
- Director / Worker の役割区別（どの bot か）は entrypoint では分けず、メタの `bot_role`（`director` | `worker` | `unknown`）に残す。実モデル名も同じメタに残す。OSS の公開 record には person の実値も agent member の生識別子も入れない。それらは組織版 receipt の既存の別列に残す（§6・§11.3）。entrypoint を役割ごとに増やすと enum が運用で膨らむため。
- 共有契約（enum）の変更は影響範囲が広い（§8・§9 の S1）。`src/judgment-history.ts` に加え、同じ enum を持つ外部正本（`contract.js:7` ＝ #878 の引用。sandbox 外）にも `grok_bot` を足す必要がある。合意は実装 Story で取る。

### 4.2 record に埋める項目
- `entrypoint` = `grok_bot`（§4.1）。
- `record_id` ← §7 の `resolution_id` から決定的に導出（`src/judgment-history.ts:78` の `record_id`）。
- `recorded_at` ← `resolved_at`（判断確定の時刻。表示順の正本。#878 §4.3・§8）。
- `project_code` ← その判断が属する project。Grok Bot が記録時に渡す（会話の文脈から bot が決める）。共有 record 型は `string | null`（`src/judgment-history.ts:85`、`missing_fields` `:86`）。組織版へは未解決のまま送らず、理由コード `grok_bot_project_unresolved` を残す（§11.3）。一意キーが `project_code` を含むため。
- `turn_ref` ← `sha256(session_id)/sha256(turn_id)`（既存 `TURN_REF` 形式＝ #878 `contract.js:15` の引用）。
- `judgment` ← 明示記録された `public_frame`（summary / reason）を `JudgmentHistoryJudgment`（`src/judgment-history.ts:63-69`: status / summary / reason / selected_references / alternatives）へ写す。Grok Bot が selected_references / alternatives を明示記録していなければ `null`、`missing_fields` に明記。
- `execution` ← Grok Bot 経路では `unknown` 既定（`src/judgment-history.ts:70-74`。結果追跡は別イベント）。

### 4.3 識別子と時刻の取り方
- `session_id`: Grok Bot の会話（スレッド）識別子。記録コマンド呼び出し時に Grok Bot が渡す。
- `turn_id`: その判断ブロックの識別子（例「判断2」に対応する一意の値。メッセージ id や連番など）。記録コマンド呼び出し時に渡す。
- `resolved_at`: 判断を下した時刻（ISO）。Grok Bot が渡す。欠落・不正・境界前は送らず理由コードだけ残す（#878 §8 の受入条件(1)(2)(3) をそのまま継ぐ。例 `grok_bot_resolved_at_missing` / `_invalid` / `_before_boundary`）。配送時刻での代替はしない。
- `project_code`: §4.2 と §11.3。未解決なら組織版へ送らない。
- 実モデル名: receipt メタ情報（entrypoint にしない。§4.1）。
- **送らないもの**: プロンプト全文、会話本文・応答全文、ツール応答、token / bearer / person の実値（#878 §5 のログ規則を継ぐ。公開は public_frame の summary / reason のみ）。

### 4.4 public_frame を誰がどう明示記録するか
- 記録の担い手は **Grok Bot 自身**。判断ブロックを出すとき、そのうち「owner-only 投影に出してよい要約と理由」だけを `public_frame`（summary / reason）として記録コマンドに渡す（#878 §3.3 の「呼び手が明示したときだけ渡す optional 値」と同じ契約）。
- Core（記録入口）は会話・応答・内部推論から public_frame を **導出しない**（#878 §3.3）。
- 記録時に public_frame の digest を付す（`judgmentFramePublicFrameDigest` `src/judgment-frame.ts:241`、`sha256:` 形）。これが §7 の content_digest と履歴投影の正本。
- 欠落時（当該判断に明示 public_frame が無い／空）: その判断は履歴に送らず、outbox・ログに理由コードだけ残す（例 `grok_bot_public_frame_absent`。#878 §3.3）。判断本文の中身はログに残さない。
- 不正時（秘密混入・制御文字・不明キー・長さ超過）: 記録段階で **拒否**（`frame_public_invalid`、`src/judgment-frame.ts:416-438`）。除去・書き換えで通さない。
- 永続化の担い手（#878 §3.3 と同じ論点）: `brainbase_judgment_frame_record` は検証結果と public_frame を返すだけで turn 別 journal に永続化しない。したがって記録された public_frame（と digest）を session/turn と紐付けてローカル journal/outbox に書く担当は **Grok Bot 側のアダプタ（＝記録コマンド／共通送り口）** が持つ。保存先・キーは #878 §3.3（`<sessionRef>/<sha256(turnId)>.*.json`、キー = sessionRef / turnRef / digest）に倣う。

---

## 5. RQ-119 の共通送り口（#878 S1, worker-judgment-emitter）を使うか

**使う（再利用する）。** 新しい送り口は作らない。理由: Grok Bot の判断も、道具の判断と同じ共有 record 契約・同じ `resolution_id` 導出・同じ冪等受領・同じ outbox / 再送に乗る。CLAUDE.md の「共通部品はコピーせず所有するリポジトリで変更」にも一致（送り口の最終所在は brainbase）。

RQ-119 S1 をそのまま使える部分:
- 共有 record 契約の組み立てと public_frame の秘密混入拒否（#878 §3.1・§3.3）。
- `resolution_id` の決定的導出（#878 §6。§7 で Grok 用に具体化）。
- ローカル outbox・原子的書き込み・再送・失敗保持・`blocked_credential`（#878 §7）。
- effective_after 境界・バックフィルしない方針（#878 §8）。

S1 に **足りない点（本件で足す差分）**:
1. **entrypoint `grok_bot` の追加**（§4.1）。S1 の契約骨格は enum に依存するため、enum に `grok_bot` を加える（＋外部正本 `contract.js`）。
2. **道具イベントに依存しない入力口**。S1 のアダプタ入力は hook イベント（Stop / session.idle）を前提にしている。Grok Bot にはそのイベントが無いので、**記録コマンド（CLI / MCP tool）から session_id / turn_id / resolved_at / project_code / public_frame を直接受ける入力路**を S1 に足す（§3 案(c)・§4.3）。S1 は「イベント適応層は薄いアダプタ、認証・冪等・送信・保持は共通」という分離（#878 §3.2）なので、Grok 用アダプタ＝記録コマンドを新規に足すだけで中核は共有できる。
3. **実モデル名・bot_role のメタ情報**をメタ欄に通す（S1 が受けて receipt メタに載せる。§4.1）。
4. **判断ブロック＝ turn の区切り規約**（§2）に対応する turn_id の受け口（S1 は turn_id を受けるだけでよく、区切りの決定は Grok Bot 側）。

いずれも S1 の中核契約を変えず、入力口と enum を広げるだけで足りる。

---

## 6. 認証（§5 #878 の `judgment.record` 認可を Grok Bot に付ける）

RQ-119 §5（#878）の agent 資格・認可の枠組みをそのまま使う。Grok Bot 固有の差分だけ書く。

- 原則: Grok Bot は人ではない。owner JWT（人の資格）を流用しない（#878 §5）。使うのは組織版の **agent 資格（agent-credential-service / `agent-mcp-authorization.js`。#878 §5 の引用、sandbox 外）**。
- agent member 資格を Director と Worker で分けるか、Grok Bot 群で 1 つにするかは §11.1（推奨は分ける）。scope は 1 組織・1 テナント・対象 project に限定し、`judgment_receipts` の RLS（#878 §4・§5 の引用）と整合させる。必要な権限は `judgment:write`（下記）。
- **帰属の写像**（#878 §5 の決定事項(1) をそのまま継ぐ）: receipt の `owner_person_id` には、照合済み資格行が示す **owner person（project owner。例 オーナー）** を入れる。Grok Bot 自身（agent member の personId）は `owner_person_id` にしない。agent 本人の personId は別列（メタ）に記録し、照合されていない owner 指定は拒否する。これにより `judgment_receipts` の一意キーと RLS が成立する。
  - 意味: 「Grok Bot 自身の判断」も、履歴上の持ち主は **委任元の人（project owner）** である。entrypoint `grok_bot` と実モデル名・bot_role メタで「実際に判断したのは Grok Bot である」ことは残る。
- **判断記録用の認可**（#878 §5 の決定事項(2)(b)）: `agent-mcp-authorization.js` の操作別認可は既存のタスク／進捗ツール限定で判断記録は対象外。判断記録用の `toolName='judgment.record'`、`resourceId`（`project_code`（＋ owner person）スコープ）、必要権限 `judgment:write` を新たに定義する必要がある。Grok Bot の資格にこの権限を付与して初めて記録できる。この認可が定義されるまでは本人（資格）確認だけで書き込みを許さない。
- **資格の出し直しは人の操作で、人の通常操作とは別の承認が要る**（#878 §5 の決定事項(2)(a)・未決事項8 を継ぐ。本件で明示）:
  - agent-credential-service の `issue()` は `authority()` で有効な人間の owner/CEO を要求し、agent 自身からの発行を拒否する（#878 §5 の引用）。したがって **Grok Bot は自分の資格を作り直せない**。
  - 資格の出し直し（issue / 再発行）は、Grok Bot の判断を記録するという通常の運用操作とは **別の、人（owner/CEO）による明示承認** を要する。Grok Bot が「記録のために資格が要る」と判断しても、それだけで資格を得ることはできない。人の承認の記録（誰が・いつ・どの scope で発行したか）を残す。
  - Grok Bot の送り口は送信前に必ず資格の有効性を確かめ、期限切れ／失効を検知したら自動再発行せず outbox を保持して停止し（`blocked_credential`、理由コード例 `agent_credential_expired` / `agent_credential_revoked`）、人に再発行が必要なことを知らせる。人が再発行した後に `blocked_credential` を `pending` に戻して再開する（#878 §7）。
- 受け手側（組織版）: 非 person（agent）認証を受理する判断受領エンドポイント（#878 S4 と同じ口）を使う。`agent-mcp-authorization.js` の資格行照合（agentMemberId / ownerPersonId の区別・scope・失効確認）に通し、照合済み ownerPersonId を保存用 actor へ写像してから `judgment_receipts.record()` を呼ぶ。Grok Bot 専用の新しい受領口は作らず、RQ-119 S4 の受領口に entrypoint `grok_bot` を受理させるだけにする（口の分散を避ける）。
- ログ規則: token / bearer / person の実値、プロンプト全文、応答、会話本文を outbox・ログに出さない。失敗は理由コード（`judgment_*` / `grok_bot_*` 形）だけ（#878 §5）。
- 置き場: box 上の秘密置き場（正規経路）。owner 限定・0600・symlink 拒否（#878 §5）。

> 推測の明示: agent credential の発行・検証の実フィールド、委任・scope・失効の実装（`agent-mcp-authorization.js`）は本セッションで直接確認できず、#878 の引用に依拠する。実装前に原本で再確認する。

---

## 7. 冪等性・再送・失敗時の理由コード（#878 §6・§7 にそろえる）

RQ-119 §6（冪等受領契約）・§7（失敗保持）をそのまま継ぐ。Grok 用の具体化だけ書く。

### 冪等性（#878 §6）
- 一意キー: `judgment_receipts` の `UNIQUE (organization_id, project_code, owner_person_id, resolution_id)`（#878 §4 の引用）をそのまま使う。
- `resolution_id` の決定的導出: `resolution_id = f(entrypoint='grok_bot', session_id, turn_id, content_digest)`（#878 §6 と同じ関数。canonical JSON の sha256 を安全なコード形に収める）。同じ判断ブロック・同じ内容なら同じ `resolution_id` → `already_saved`（成功扱い、冪等）。
- 受領契約: 既存 repository は `ON CONFLICT DO NOTHING` 後に内容比較なしで常に 409 を返す（#878 §6 の引用、`judgment-receipt-postgres-repository.js:129`）。同一内容の再送を `already_saved` にするには、受領口側で 409 時に既存行を読み戻し receipt_digest を比較する処理の追加実装が前提（#878 §6）。これは RQ-119 S4 の作業で、本件はそれを共有する。
  - 同一キー＋内容一致 → `already_saved`（成功。`src/judgment-history.ts:44` の `status:'saved'|'already_saved'`）。
  - 同一キー＋内容相違 → 競合 409 `judgment_receipt_immutable_conflict`。黙って上書きしない。送り手は理由コードを残し、resolution_id 導出ミスや内容取り違えとして扱う。
- content_digest ／ receipt_digest の役割分担は #878 §6 と同じ。
- 判断の訂正（同じ判断ブロックを後で訂正した場合）: #878 §9 未決事項6 を継ぐ。選択肢・推奨・権限・migration の有無は §11.2。Director の確認前は未決。推奨は、行を更新せず別 `resolution_id` の receipt に `kind: correction` と元 record へのリンクを載せる。`JudgmentHistoryFeedbackEvent`（`src/judgment-history.ts:34-39`、kind=`correction`）は読み出し側の形であり、専用表は作らない。

### 失敗保持（#878 §7）
- ローカル outbox: 共通送り口が送信前に `pending/attempts/status/envelope-digest` を書く（#878 §7、envelope と digest のみ）。
- 状態遷移: `pending` → `saved`（`already_saved` 含む）／`failed`（上限）／`blocked_credential`（資格待ち・停止。§6）。
- 再試行: 次の記録コマンド実行時（または別経路の relay）に `pending` を再送。上限有限。transport / 5xx / 429 は再試行、401/403・契約拒否は即停止。401/403 が資格失効なら `blocked_credential` に移す（#878 §7）。
- 可視化: 失敗は理由コード（`judgment_*` / `grok_bot_*`）を残し、Director が件数・最終状態を確認できる場所に出す。staging の Cloud Run `/tmp` 揮発の注意も #878 §7 と同じ。

### 本件の理由コード（例、#878 の `judgment_*` 形に合わせる）
- `grok_bot_public_frame_absent`: 当該判断に明示 public_frame が無い／空。
- `grok_bot_resolved_at_missing` / `_invalid` / `_before_boundary`: 判断時刻の欠落・不正・境界前（#878 §8）。
- `frame_public_invalid`: public_frame が秘密混入・制御文字・不明キー・長さ超過（記録段階で拒否、`src/judgment-frame.ts:416-438`）。
- `agent_credential_expired` / `agent_credential_revoked`: 資格の期限切れ／失効（§6。`blocked_credential` へ）。
- `judgment_receipt_immutable_conflict`: 同一キー・内容相違の競合（#878 §6）。
- `grok_bot_project_unresolved`: `project_code` を解決できない。組織版へ送らない（§11.3）。

---

## 8. 組織版（brainbase-organization）側で要る変更と npm 公開

> sandbox 外のため #878 の引用に依拠。実装前に原本で再確認。

### 組織版で要る変更（RQ-119 S4 と大半を共有）
1. **判断受領エンドポイント（非 person / agent 認証）**: RQ-119 S4 で設計する受領口に、entrypoint `grok_bot` を受理させる。Grok 専用の新口は作らない（口の分散回避）。現 route は person 専用（`public-projection-route.js:19,391` の引用）なので、agent 資格受理の口が前提（S4 と共有）。
2. **`judgment.record` 認可の定義**（§6）: `agent-mcp-authorization.js` に `toolName='judgment.record'` / `resourceId`（project スコープ）/ `judgment:write` を定義し、Grok Bot の agent member にその権限を付与できるようにする（RQ-119 S4 と共有の定義）。
3. **Grok Bot の agent credential**: Director / Worker の Grok Bot に agent member 資格を発行する運用（人の承認つき。§6）。これは組織版の発行フローの運用設定であり、OSS の範囲外。
4. **409 読み戻し・receipt_digest 比較の追加実装**（#878 §6。RQ-119 S4 と共有）。
5. **entrypoint `grok_bot` の受理**: 受領口・履歴投影（RQ-116 連携）が `grok_bot` を既知の entrypoint として扱えること。entrypoint `codex` 固定の public-projection 契約（#878 §2.3 の引用、`public-projection.js:17,353`）は案A（DB 直書き）では迂回するため、`grok_bot` は DB receipt / 投影に素直に載る。
6. **メタ情報の受理**: 実モデル名・bot_role を receipt メタに格納できること。

### npm 公開が要る箇所
- **共有 record 契約パッケージ**（本リポジトリ brainbase が公開する `@unson/brainbase-mcp`。公開手順は Skill `brainbase-npm-publish`）: `JUDGMENT_HISTORY_ENTRYPOINTS` に `grok_bot` を足す変更（`src/judgment-history.ts:11-17`）は、組織版がこのパッケージを consume して enum を共有している限り、**組織版が新 enum を使うには再公開が必要**。
  - 本タスクの範囲は設計のみ。npm 公開は行わない（制約）。公開は別途、承認を得た公開フロー（Skill `brainbase-npm-publish` / `npm-package-publish`）で行う。
  - 外部正本 `contract.js`（#878 の引用）の enum も同期が要る。どちらが正本でどちらが同期先かは実装 Story で確定（#878 の記法に合わせる）。
- 組織版は OSS UI / 契約を consume・拡張する側（CLAUDE.md）。組織版内の受領口・認可定義は組織版リポジトリの変更であり npm 公開の対象ではない。

---

## 9. Story 分割（Draft PR 単位）と受入条件

各 Story は独立した Draft PR を想定。RQ-119 の Story と共有できるものは共有し、重複実装しない。

- **G1: 共有契約へ entrypoint `grok_bot` を追加（brainbase）**
  - 内容: `JUDGMENT_HISTORY_ENTRYPOINTS` に `grok_bot` を追加（`src/judgment-history.ts:11-17`）。外部正本 `contract.js` の enum 同期の設計明記。実モデル名・bot_role をメタに通す型の追加。
  - 受入: `grok_bot` が既知 entrypoint として型・schema を通る。既存 entrypoint の record は不変。OSS 単体（organization なし）でビルド・型チェックが通る（CLAUDE.md 境界）。
  - テスト: 契約の単体テスト（enum・record 形・メタ項目）。
  - 備考: この変更は npm 公開が必要になる（§8）。公開は本 Story の範囲外（別途承認フロー）。

- **G2: Grok Bot アダプタ＝明示記録コマンド（記録入口、brainbase）**
  - 内容: §3 案(c) の記録コマンド（CLI / MCP tool `judgment.record` 入口）。session_id / turn_id / resolved_at / project_code / public_frame / 実モデル名 / bot_role を受け、RQ-119 S1 の共通送り口へ渡す。public_frame の秘密混入拒否・欠落時の理由コード（§4.4・§7）。
  - 受入: 1 判断ブロックで outbox に 1 件、entrypoint=`grok_bot`、`resolution_id` が同一入力で同一。明示 public_frame が無い入力は送らず `grok_bot_public_frame_absent` を残す。秘密混入は拒否（除去・書き換えしない）。resolved_at 欠落・不正・境界前は送らず理由コードを残す。
  - テスト: 固定入力 → outbox 内容検証（送信はモック）。
  - 依存: RQ-119 S1（共通送り口）。S1 が未実装なら S1 と同時／後。

- **G3: RQ-119 S1 への入力口拡張（道具イベント非依存の入力）**
  - 内容: §5 の「足りない点2」。S1 に、hook イベントに依存しない記録コマンド入力路と、実モデル名・bot_role メタの通し口を足す。中核契約（resolution_id・outbox・冪等・認証）は変えない。
  - 受入: Grok 経路（イベント無し）と Worker 経路（イベント有り）が同じ中核契約を共有し、同じ outbox / 冪等導出に乗る。
  - テスト: 両経路の入力で同形 record・同一 `resolution_id` 導出。
  - 備考: RQ-119 S1 の PR に含めるか別 PR にするかは S1 の進行で判断。

- **G4: 組織版 受領口の entrypoint `grok_bot` 受理と `judgment.record` 認可（brainbase-organization）**
  - 内容: §8 の 1・2・5・6。RQ-119 S4 の受領口・認可定義に `grok_bot` と Grok Bot agent member の権限付与を足す。409 読み戻し・receipt_digest 比較（§7）は S4 と共有。
  - 受入: 正資格の Grok Bot record が saved、再送で冪等（`already_saved`）、内容相違で 409、失効資格で 403・outbox 保持（`blocked_credential`）。owner JWT を要求しない。entrypoint `grok_bot` が receipt / 投影に載る。
  - テスト: 受領口の結合テスト（冪等・RLS・資格失効・entrypoint 受理）。
  - 依存: RQ-119 S4。別リポジトリ（brainbase-organization）の PR。

- **G5: 失敗保持と可視化（RQ-119 S5 と共有）**
  - 内容: outbox の pending/retry/上限/`blocked_credential`、理由コードの可視化（§7）。
  - 受入: transport 失敗で pending 保持 → 再送、上限で failed、資格失効で `blocked_credential`、理由コードが残る。
  - テスト: 失敗注入でのリトライ／上限／停止／可視化。
  - 備考: RQ-119 S5 の仕組みを共有。Grok 固有の理由コードを足すだけ。

- **G6（RQ-116 連携・読み出し）**: `judgment_receipts` から履歴を投影し、Codex / Worker / Grok Bot を同一表示（entrypoint で区別可能）。RQ-116 の Story として進め、同一表・同一一意キーで突き合わせる。RQ-126 単独では表示まで到達しないことを明記（#878 §4・§9 と同じ前提）。

### Draft PR の順序（推奨）
G1 →（G3 と同時）G2 → G4（別リポジトリ）→ G5 → G6（RQ-116 連携）。G1・G2・G3・G5 は brainbase（OSS）、G4 は brainbase-organization、G6 は RQ-116。npm 公開（§8）は G1 の内容が合意された後、別途承認フローで。

---

## 10. 推測の明示

- Grok Bot（Director / Worker）の実行基盤（box プロセスか、ホスト型 Grok チャットか）と、そこから CLI / MCP tool を呼べるかは本セッションで直接確認できていない＝推測（§3）。実装前に Grok Bot の実行基盤を確認する。
- 「判断」の区切り（番号付き判断ブロック）は根拠の連絡から観測した形に基づく。Grok Bot が常にこの形で判断を出すか、記録コマンドを毎回呼べるかは運用規約の前提＝要確認（§2・§3 案(c)）。
- 外部ファイル（要件台帳、`contract.js`、`brainbase-organization`、社内の配備リポ、agent credential / `agent-mcp-authorization.js`、受領 repository の `ON CONFLICT DO NOTHING` 挙動と 409、public-projection の entrypoint 固定）は本セッションの作業ディレクトリ外にあり、brainbase#878（RQ-119 設計書）の記載・行番号に依拠した引用である＝一部推測。実装前に原本で再確認する。
- brainbase 内の `src/judgment-history.ts`（entrypoint enum `:11-17`、record `:77-89`、judgment `:63-69`、feedback `:34-39`、status `:44`）と `src/judgment-frame.ts`（public_frame キー `:209`、最大長 `:49`、digest 宣言 `:241`、credential 検知 `:220`、検証 `:416-438`）は本セッションで直接確認した（develop 時点。当該2ファイルは PR 分岐後の develop 先端でも差分なし）。
- 組織版の `judgment_receipts` に entrypoint 用の CHECK や SQL enum が無いかは、本セッションでは原本を再読していない。§11.3 の「migration 不要」はこの未確認を残した推奨である。

---

## 11. Director が確認する未決事項（選択肢・推奨・権限・migration）

本節は、残っている選択を Director が採るかどうかの材料である。推奨は Director の判断ではない。確認が終わるまで未決のままにする。実装、migration の適用、npm 公開は行わない。組織版の schema と認可実装は本セッションで再読しておらず、#878 の引用に依拠する（§10）。

### 11.1 資格を Bot ごとに分けるか

未決: Grok Bot の agent member 資格を Director と Worker で分けるか、群で 1 つにするか。人を介さない再発行を許すか。

選択肢:
- 案1（推奨）: Director と Worker で agent member 資格を分ける。scope はいずれも 1 組織・1 テナント・対象 project。再発行は人（owner/CEO）の明示承認だけにする。Bot 自身の `issue()` は拒否されたままにする。期限切れは `blocked_credential` で停止する（§6）。
- 案2: Grok Bot 群で 1 資格にする。付与と失効は一度で済む。片方の失効が両方の記録を止める。
- 案3: 期限切れを Bot または自動サービスが再発行する。#878 §9 未決事項8 の経路。#878 が引用する `issue()` は人の owner/CEO を要求する、という記載と衝突する。

推奨: 案1。記録の停止範囲を Bot ごとに閉じ、資格を発行する権限は人に残す。

必要な権限:
- 記録: `toolName='judgment.record'`。`resourceId` は `project_code` スコープ。権限名は `judgment:write`。付与先は当該 Bot の agent member。この定義と付与が終わるまで、資格の本人確認だけでは書き込まない（§6）。
- 発行と再発行: 既存の人（owner/CEO）の `authority()`。新しい DB 権限は足さない。
- 記録に使わないもの: owner JWT、既存のタスク／進捗ツールの権限、Bot 自身による `issue()`。

migration: 不要。資格は組織版の既存 agent credential の運用であり、`judgment_receipts` の列・GRANT・RLS を変えない。

### 11.2 同じ判断ブロックの訂正をどう残すか

未決: 同じ session / turn の判断を後から訂正したとき、履歴にどう残すか（#878 §9 未決事項6）。

前提: `resolution_id = f(entrypoint='grok_bot', session_id, turn_id, content_digest)`（§7）。summary / reason が変われば content_digest が変わり、別 `resolution_id` になる。既存行の上書きは受領契約が拒否する。

選択肢:
- 案1（推奨）: 訂正は別 `resolution_id` の別 receipt として追記する。receipt JSONB に `kind: 'correction'` と、訂正対象の `record_id`（または元の `resolution_id`）へのリンクを載せる。先の receipt は更新しない。投影（G6 / RQ-116）が、同じ turn の複数 receipt のうち後の `resolved_at` を訂正として束ねる。OSS の `JudgmentHistoryFeedbackEvent`（kind=`correction`、`src/judgment-history.ts:34-39`）は読み出し側の形である。保存のための新しい表は作らない。
- 案2: 同一 receipt 行の JSONB に feedback を追記する。現行の不変契約（内容相違は 409）と衝突し、repository に更新経路が要る。列の追加は無い。
- 案3: feedback 専用の表を新設する。migration が要る。本件の範囲を超える。

推奨: 案1。冪等キーと不変契約を維持し、訂正であることは JSONB のリンクで残す。

必要な権限: 訂正 record も初回と同じ `judgment:write`。訂正専用の権限は足さない。

migration: 案1は不要（リンクは既存の receipt JSONB）。案2も列の migration は不要で、不変契約の変更が要る。案3は migration が要る。推奨は案1。

### 11.3 保存先と migration の有無

未決: Grok Bot の record をどこへ書くか。そのために DB migration が要るか。

選択肢:
- 案1（推奨）: #878 の案Aを継ぐ。既存 `judgment_receipts` へ、RQ-119 と同じ受領口から書く。entrypoint `grok_bot`、`bot_role`（`director` | `worker` | `unknown`）、実モデル名は receipt JSONB のメタに載せる。OSS 共有 record には任意の `actor_meta` を G1 で足す。中身は `model` と `bot_role` だけにする。person の実値と agent member の生識別子は入れない。この型追加は npm 公開の対象であり（§8）、DB migration ではない。公開は別承認であり、本書では行わない。
- 案2: `bot_role` や entrypoint を新しい列、または SQL enum / CHECK の変更として schema に足す。migration が要る。
- 案3: 既存 public relay（#878 案B）に載せる。#878 の記載では entrypoint が `codex` 固定であり、認証が owner JWT に戻る。採らない。

推奨: 案1。

`project_code` が解決できない判断は組織版へ送らない。理由コード `grok_bot_project_unresolved` を outbox に残す。一意キーと RLS が `project_code` を含む、という #878 の記載に合わせ、null の行は挿入しない。共有 record 型が `string | null` であることは、ローカルで欠落を表すためであり、受領口がその null を受け入れる意味ではない。

必要な権限: §11.1 と同じ `judgment:write`。受け手は既存 RLS（owner / project / org）のままにする。新しい GRANT / ROLE / RLS policy は作らない。呼び出しが自己申告した owner は拒否し、照合済み資格行の owner person だけを `owner_person_id` に写す（§6）。

migration:
- 推奨案（案1）: **不要**。新しい表、列、CHECK、GRANT、ROLE、RLS policy は作らない。
- 根拠は #878 が引用する schema である。列は `organization_id`, `project_code`, `owner_person_id`, `resolution_id`, `turn_id`, `receipt`（JSONB）, `created_at`。entrypoint はその JSONB に載る、という記載である。本セッションでは組織版の schema 原本を再読していない（§10）。実装の G4 に入る前に、entrypoint を限定する CHECK または SQL enum が無いことを原本で確認する。もしあれば、その制約を広げる migration が要る。推奨は、その migration を先に作らず、JSON として受理できることを確認してから G4 に進む、である。
- `judgment:write` は `agent-mcp-authorization` の操作定義であり、SQL migration ではない。

### 11.4 実装前に確認するが、Director の選択ではないもの

- Grok Bot の実行基盤から、記録コマンド（CLI または MCP の `judgment.record`）を呼べるか（§3・§10）。呼べないと分かった場合は、会話解析（§3 案(b)）には倒さず、設計を止めて報告する。
- `contract.js` と `src/judgment-history.ts` のどちらを enum の正本にするかは、G1 の実装 Story で確定する（§4.1・§8）。値は `grok_bot` で揃える。
- G3 を RQ-119 S1 の PR に含めるか別 PR にするかは、S1 の進行で決める（§9）。

### 11.5 Director への確認（本書の推奨）

1. 資格は Director と Worker で分ける。再発行は人（owner/CEO）の別承認のみ。権限は project スコープの `judgment:write`（`toolName='judgment.record'`）。migration は不要。
2. 訂正は行を更新しない。別 `resolution_id` の receipt に `kind: 'correction'` と元 record へのリンクを載せる。権限は初回と同じ。migration は不要。
3. 保存は既存 `judgment_receipts` の JSONB。entrypoint `grok_bot`、`bot_role`、実モデル名もそこへ載せる。新しい列・GRANT・RLS は足さない。migration は不要。原本に entrypoint を拒む CHECK または SQL enum があれば、そのときだけ migration を別判断にする。

---

## 変更範囲の確認
本作業で追加・更新したファイルは本書 1 ファイルのみ:
`docs/specs/rq126-grok-bot-judgment-emission-design.md`。
コード・テスト・他ドキュメント・`package.json` の version・CHANGELOG・`.github/` は変更していない。実装・npm 公開・本番反映・配備・DB migration/schema/GRANT/ROLE/RLS の適用は行っていない。

- 2026-10-29 更新: §11 を追加し、資格の粒度・訂正の残し方・保存先について選択肢、推奨、必要な権限、migration の有無を書いた。いずれも Director 確認前の推奨であり、決定済みにはしていない。`judgmentFramePublicFrameDigest` の引用行を宣言行 `:241` に、public_frame 検証の引用を `:416-438` に直した。組織版へは未解決の `project_code` を送らない理由コード `grok_bot_project_unresolved` を足した。
