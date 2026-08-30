# Spec: Autonomous Judgment Runtime v1

## AJR-001: Brainbase CoreはLLM非依存である

Brainbase Coreと既存Judgment Hostは、判断基準・receipt・episode・監査証拠の正本であり、特定LLM SDKへ依存してはならない。意味判断は`JudgmentIntelligenceProvider`へ委譲する。

## AJR-002: Stopの人間質問を三分類する

Stop回答が人間質問でない場合は、既存`processJudgmentHook`へ無変更で委譲する。人間質問の場合は以下へ分類する。

- `continue`: 明白に安全・可逆な通常工程
- `human`: 本番破壊、外部送信、金銭・契約の硬い境界
- `semantic`: 既存基準の意味適用、価値選択、権限・秘密の自己申告など

分類対象は回答末尾の直接的な人間要求だけとする。説明中の疑問文、引用、コード例は人間エスカレーションとして扱わない。

## AJR-003: 低リスク確認はLLMなしでNGにする

`continue`は独立Resolverを呼ばない。次を含む`decision:block`を返す。

- 人間質問がNGである理由
- 中止する質問
- 次に実行する具体的行動
- 完了条件
- 高リスク権限を新たに与えない旨

## AJR-004: グレーゾーンだけ独立Resolverを呼ぶ

`semantic`は既定で`CodexCliJudgmentProvider`を呼ぶ。Providerは次の条件を満たす。

- `gpt-5.6-sol`を既定モデルとする
- 人間質問を通せる出力は`HUMAN_REQUIRED`だけとする
- separate process、ephemeral、空の一時directory、read-only、approval never
- user config/rulesを無効化する
- Packetはstdinで渡し、process listとOS引数長上限から分離する
- JSON Schemaへ完全準拠した結果だけを返す
- subprocess環境へ`BRAINBASE_RESOLVER_ACTIVE=1`を設定する
- mode `off|same-worker`ではProviderを無効化できる

## AJR-005: Resolver出力をHostが再検証する

Resolver出力は以下を満たさなければならない。

- verdictは`OK|NG|OK_WITH_CONDITIONS|HUMAN_REQUIRED`
- reasonは空でない
- basis IDはTask Judgment Packet内に存在する
- HUMAN_REQUIRED以外は`do_next`と`acceptance_criteria`を持つ
- HUMAN_REQUIREDは許可reason codeとquestionを持つ
- `missing_authority|missing_secret|verified_terminal_blocker`にはtrusted evidence refが必要

無効出力は採用せず、semantic fallbackへ移る。

## AJR-006: Packetは現行episodeからコンパイルする

Task Judgment Packetは以下を含む。

- original task objective
- project binding
- existing applicable policies
- active DAG node instructions
- digest検証済みの同一turn Brainbase MCP結果
- 利用可能なローカルSSOTのDecision・value・judgment
- built-in autonomy policy
- delegation boundary
- policy snapshot hash

source IDはentity IDまたはHost event digestへ束縛する。event projectionはsecret系キーをredactし、source数と文字数を上限管理する。

adoption v2は`request_text_digest`と`receipt_digest`を再計算し、一致しない内容を判断sourceとして使わない。

## AJR-007: Decisionを状態へ束縛して不変保存する

Decision recordは`episode_id`、`case_digest`、`state_digest`、`policy_snapshot_hash`を持つ。同一case digestのDecisionは再利用し、Provider呼び出しを重複させない。保存物はHost source、provider ID、decision path、record digestを持つ。

## AJR-008: 再帰と無限差し戻しを防ぐ

Resolver subprocessではAutonomy層をbypassする。Stop continuation後に同一caseを再提出した場合は即時fail closedする。Brainbase参照やstateが進んでcase digestが変わった場合は継続できるが、1 turnあたりのAutonomy差し戻しは既定2回を上限とする。

## AJR-009: 既存監査を維持する

HUMAN_REQUIREDまたは人間質問でないStopは、既存`processJudgmentHook`へ委譲し、knowledge.resolve、owner audit、answer body preservation、final receiptの既存契約を維持する。

## AJR-010: 公式CLI入口をAutonomy wrapperへ切り替える

npmの`brainbase` binは`dist/autonomy-cli.js`を指す。wrapperの`judgment:install`はUserPromptSubmit、PostToolUse、Stopを同じwrapperへ登録する。他のCLI commandは既存`runCli`へ委譲する。

## 設定

| 環境変数 | 既定値 | 意味 |
|---|---:|---|
| `BRAINBASE_JUDGMENT_RESOLVER_MODE` | `auto` | `auto`, `codex`, `off`, `same-worker` |
| `BRAINBASE_JUDGMENT_RESOLVER_COMMAND` | `codex` | Resolver CLI command |
| `BRAINBASE_JUDGMENT_RESOLVER_MODEL` | `gpt-5.6-sol` | 独立Resolver model |
| `BRAINBASE_JUDGMENT_RESOLVER_TIMEOUT_MS` | `120000` | subprocess timeout |
| `BRAINBASE_JUDGMENT_PRINCIPAL_ID` | `authenticated_owner` | 判断主体 |
| `BRAINBASE_JUDGMENT_MAX_AUTONOMY_BLOCKS` | `2` | 1 turnのAutonomy差し戻し上限 |
| `BRAINBASE_RESOLVER_ACTIVE` | internal | subprocess recursion guard |

## テスト対応

| Clause | Test |
|---|---|
| AJR-002/003 | low-risk confirmation is blocked without provider |
| AJR-002/009 | hard external boundary delegates to existing Stop |
| AJR-004 | semantic priority choice invokes independent provider |
| AJR-006 | current-turn event digest・redaction・episode tamper拒否・SSOT Decision追加 |
| AJR-005 | invented basis falls back; missing authority without evidence is rejected |
| AJR-007 | repeated same case invokes provider once |
| AJR-008 | resolver subprocess bypasses autonomy layer |
| AJR-010 | install config binds all hooks to autonomy wrapper |
