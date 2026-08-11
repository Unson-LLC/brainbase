---
story_id: story-ten-minute-world-onboarding
title: 最初の10分で自社の世界が立ち上がるオンボーディング
status: active
created_at: 2026-08-02
updated_at: 2026-08-02
horizon: quarter
view: product
period: 2026Q3
architecture_docs:
  - docs/architecture/ten-minute-world-onboarding-architecture.md
spec_docs:
  - docs/specs/ten-minute-world-onboarding-spec.md
---

# 最初の10分で自社の世界が立ち上がるオンボーディング

## 背景

Brainbase の初回体験を「文章を知識グラフへ変換できる」や「連携設定が完了した」で終わらせない。利用者が最初に得るべき価値は、自社の人物、組織、プロジェクト、関係、意思決定が証拠付きの仮説として立ち上がり、Brainbase がその文脈を使って実際の問いに答えることである。

外部シグナルとして、文章から SPO を抽出し、同義語を寄せ、推論関係を加えて対話的なグラフを描く OSS が確認された。これは「世界が見える」体験の参考になる。一方、出典、ACL、人の承認、Graph SSOT への昇格境界を持たないため、そのまま正本 writer にはしない。

## User Story

Brainbase を初めて使う組織の責任者として、すでに使っている MCP、Drive、Gmail、ローカル管理フォルダのいずれかを選ぶだけで、自社について Brainbase が理解した人物・組織・プロジェクト・関係・意思決定を証拠付きで確認し、誤りを直し、その理解を使った最初の有用な回答を得たい。そうすれば、知識を手で再入力せず「自社を説明し直さなくてよい」という価値を判断できる。

## 価値の定義

オンボーディング完了は次の三つが揃った時である。

1. 利用者自身の問いを一つ定義した。
2. その問いに必要な「自社の世界」が、出典付き候補として見え、利用者が確認した。
3. 確認済みの文脈だけを使った最初の有用な回答を得た。

アカウント接続、import 完了、候補件数、きれいなグラフ表示だけでは完了としない。

## Acceptance Criteria

**今回の実装 Slice 0a**

この Story は北極星全体を保持するが、今回の PR が完了判定するのは接続元 inventory の安全な受け渡し境界だけである。候補世界から最初の回答までの製品導線は、下記の「後続 slice の outcome criteria」であり、今回の実装済み判定へ含めない。

- [ ] AC-001: Agent Skill は host agent に実際に呼べる MCP / Drive / Gmail と利用者が明示した local folder だけを列挙させ、Brainbase server 内で接続状態を捏造しない契約を定義する。実接続の列挙結果と production E2E は後続 slice の runtime evidence として扱う。
- [ ] AC-002: source readiness は provider 固有の scope、認可、15分以内（最大5分の未来skewを許容）の health timestamp、秘密値を含まない evidence reference が揃う場合だけ `ready` を保持する。
- [ ] AC-003: `ready`、`waiting_for_authorization`、`unavailable`、`error`、`unconfirmed` を区別し、不正値、秘密値、重複 source ID は fail closed で `unconfirmed` にする。
- [ ] AC-004: ready な connector を単一文書より優先し、connector warm path と single-document fallback の開始可否を別フィールドで返す。
- [ ] AC-005: provider 別 valid/invalid scope、失敗状態、秘密値、重複 ID、stdin/file CLI を deterministic test で検証する。
- [ ] AC-006: Agent Skill は metadata-first、bounded retrieval、人の candidate review、Promotion Gate、Graph SSOT 再取得、first-value 判定を必須順序として定義し、未実装の live/E2E を完了と表明しない。

### 後続 slice の Product Outcome Criteria

- [ ] OUTCOME-001: 利用開始時、「Brainbase に最初に答えてほしい実務上の問い」と「既存情報をどこから読むか」を同じ開始導線で決める。
- [ ] OUTCOME-002: 接続済み MCP、Drive、Gmail、ローカル管理フォルダを発見し、利用者が account / folder / project / query / date range の読み取り範囲を選べる。
- [ ] OUTCOME-003: 利用可能な source、認可待ち、権限不足、取得失敗を区別し、接続成功や空データを onboarding 完了として扱わない。
- [ ] OUTCOME-004: source が利用可能になってから10分以内に、人物・組織・プロジェクト・関係・意思決定の候補を一つ以上含む初期世界を表示できる。
- [ ] OUTCOME-005: connector を接続したくない、または認可を待てない利用者は、単一の文章ファイルまたは貼り付け文書で同じ候補生成導線を開始できる。
- [ ] OUTCOME-006: すべての候補は source pointer、evidence hash、観測か推論か、confidence、scope を持ち、根拠へ戻れる。
- [ ] OUTCOME-007: 候補グラフ、Graph SSOT、Personal KG、AI に渡す context を視覚上も API 上も混同しない。
- [ ] OUTCOME-008: 利用者は候補を approve、edit、reject、merge でき、未承認候補と推論 edge は Graph SSOT に書かれない。
- [ ] OUTCOME-009: 初回価値デモは承認済み Graph context だけを使い、使った entity と不足 context を表示する。
- [ ] OUTCOME-010: 成功指標は warm path の `time_source_ready_to_first_value_seconds <= 600` と、最初の回答に対する利用者の useful 判定で測る。外部 OAuth や管理者承認の待ち時間は `time_to_source_ready_seconds` として分離する。
- [ ] OUTCOME-011: source、candidate、promotion、first-value answer の監査 receipt が同じ onboarding run に結び付く。
- [ ] OUTCOME-012: 権限外の source/entity は候補生成、表示、回答 context の全段で deny-by-default になる。

## 主経路

- 利用者の問いを一つ決める。
- 接続済み MCP、Drive、Gmail、ローカル管理フォルダを列挙し、利用可能性と読み取り範囲を確認する。
- 選択範囲を metadata-first で棚卸しし、問いに必要な文書や message body だけを限定取得する。
- person / org / project / relationship / decision の候補を証拠付きで生成する。
- 小さな世界マップで候補を review する。
- 承認済み候補だけを既存 Promotion Gate から Graph SSOT へ昇格する。
- 同じ問いを Graph context で再実行し、最初の価値を判定する。

共通の source adapter contract を先に置き、MCP / Drive / Gmail / local folder を同じ onboarding run に収容する。実装は adapter ごとに段階投入できるが、製品上の主経路を手入力に戻さない。

### 実装中の最初の境界

初期実装は、ホストagentが実際に呼べるconnectorを発見し、証拠付きreadinessへ正規化して安全な収集・review・Promotion Gateを案内するAgent Skillである。Brainbase serverは同一ホストの別MCPやapp connectorを列挙できないため、server内部にDrive/Gmailの架空の接続状態を作らない。provider adapter、候補world-map UI、candidate-to-Graph E2E、production計測は後続sliceとして残す。

## フォールバック経路

connector を接続したくない、認可できない、または短時間で source ready にできない利用者には、単一の文章ファイルまたは貼り付け文書を用意する。この経路も証拠、scope、review、promotion の境界は同じにする。手入力は source に何もない場合の補助であり、標準オンボーディングにはしない。

## Out Of Scope

- 入力文書の全内容を Graph SSOT へ保存すること。
- LLM が作った entity や推論 edge の自動昇格。
- 汎用 Graph explorer をオンボーディング完了と呼ぶこと。
- connector の接続成功を利用価値の証明と呼ぶこと。
- 外部送信、投稿、タスク作成を初回体験から自動実行すること。

## Links

- Architecture: `docs/architecture/ten-minute-world-onboarding-architecture.md`
- Spec: `docs/specs/ten-minute-world-onboarding-spec.md`
- Promotion boundary: `docs/architecture/ADR-010-memory-promotion-kernel-boundary.md`
- Candidate-store spec: `docs/specs/candidate-store-mvp-spec.md`
- Admin projection: `docs/architecture/brainbase-admin-visualization-architecture.md`
- External signal: https://x.com/trendtech33566/status/2083682188021874941
- Evaluated OSS: https://github.com/robert-mcdermott/ai-knowledge-graph
