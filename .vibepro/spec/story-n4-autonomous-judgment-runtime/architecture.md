# Architecture: Autonomous Judgment Runtime

## 判断

Brainbase CoreへLLMを組み込まない。既存の決定論的Judgment Hostの前段にAutonomy層を置き、意味判断が必要なcaseだけ、差し替え可能な`JudgmentIntelligenceProvider`へ委譲する。

```text
Codex Worker (GPT-5.6 Sol)
        │ Stop / human question
        ▼
Autonomy Hook Layer
        ├─ 明白な低リスク ── LLMなしでNG + 継続指示
        ├─ 明白な硬い境界 ── HUMAN_REQUIRED + 既存Stopへ
        └─ 意味的グレーゾーン
                ▼
Independent Codex Resolver
  separate process / read-only / structured output
                ▼
Host validation
  basis / scope / evidence / schema / idempotency
                ├─ HUMAN_REQUIRED ── 既存Stopへ
                └─ OK・NG・条件付き ── decision:blockでWorker再開
```

## コンポーネント

### Brainbase Core / existing Judgment Host

LLMを持たない。現在のroute receipt、適用policy、DAG node、episode、tool event、final receiptを正本として維持する。既存`processJudgmentHook`は監査の最終関所として残す。

### `judgment-autonomy.ts`

Stop前処理を担当する。

- 人間質問の検出と三分類
- Task Judgment Packetのコンパイル
- Decision Caseの生成
- Provider invocation
- basis ID、出力schema、人間境界の検証
- state/policy snapshotに束縛した不変Decision保存
- Workerへ返す実行可能なcontinuation instructionの生成

### `LocalBrainbaseJudgmentSourceProvider`

独立Resolverの前に、判断材料を決定論的に収集する。

- digest検証済みの同一turn Brainbase MCP eventを取り込む
- ローカルSSOTのDecision、value、judgmentを読み取り専用で検索する
- project scopeで検索し、該当がなければunscopedへfallbackする
- entity IDまたはhost event digestをbasis IDとして固定する
- secret/token/password系キーをevent projectionからredactする
- 最大48 source、1 source最大6,000文字へ制限する

この層もLLMを持たない。意味適用だけをResolverへ渡す。

### `CodexCliJudgmentProvider`

独立したCodex subprocessを意味判断エンジンとして使う。Brainbaseへモデルを内蔵するのではなく、Providerとして差し込む。

- model既定値: `gpt-5.6-sol`
- ephemeral thread
- 空の一時directoryで実行し、repositoryのAGENTS.mdを読ませない
- user config/rulesを無効化
- read-only sandbox・approval never
- Packetはprocess argvではなくstdinで渡す
- JSON Schemaによる構造化出力
- `BRAINBASE_RESOLVER_ACTIVE=1`による再帰防止
- 実装権限、外部送信権限、書込権限なし

### `autonomy-cli.ts`

npmの`brainbase` binaryの入口になる薄いwrapper。

- `judgment:hook`: Autonomy層を通してから既存Hostへ委譲
- `judgment:install`: Codex Hooksをwrapperへ向ける
- その他のcommand: 既存`runCli`へそのまま委譲

この分離により、73KB超の既存Hostへ大規模な侵襲を加えず、監査契約と代理判断契約を別々にテストできる。

## 判断経路

### 1. Deterministic Continue

「テストしますか」「ファイルを読んでよいですか」等。LLMを使わず、提案された人間質問をNGにする。

### 2. Deterministic Human Boundary

本番破壊、外部送信、購入・支払・契約。Autonomy decisionをHost由来で記録し、既存Stopへ渡す。これは実行許可ではなく、人間へ判断を上げてよいという判定だけである。

### 3. Semantic Resolver

既存の事業目的、Philosophy、Decisionを今回へ意味適用する必要があるcase。digest検証済みepisode、Brainbase MCP event、ローカルSSOTからTask Judgment Packetを作り、独立Providerを呼ぶ。Resolverが使えるbasisはPacket内のIDに限定する。人間質問を通せるverdictは`HUMAN_REQUIRED`だけであり、`OK|NG|OK_WITH_CONDITIONS`はWorker続行を意味する。

### 4. Semantic Fallback

Codex CLI不在、timeout、schema違反、架空basis等。人間へエスカレーションせず、メインWorkerへBrainbase MCP参照と安全・可逆な続行を命じる。

## Trust Boundary

```text
信頼する:
- Host codeに埋め込まれたautonomy policy
- digest検証済みadoption receipt
- Hostが保存したdecision record

そのまま信頼しない:
- Workerの「権限がない」「できない」という文章
- Resolverが生成したbasis ID
- LLMが自分で作った委任範囲
```

`missing_authority`、`missing_secret`、`verified_terminal_blocker`でHUMAN_REQUIREDを返すには、将来の全ツール証拠台帳からtrusted evidence refが必要である。本Storyでは証拠がないため、自己申告だけのエスカレーションはfail closedする。

## 永続化

```text
<journal>/<session_sha256>/<turn_sha256>.autonomy/
  <case_digest>.decision.json
```

Decision recordは以下へ束縛する。

- episode ID
- case digest
- state digest
- policy snapshot hash
- provider ID
- decision path
- structured judgment
- record digest

case単位のlockを使い、同一状態の同一判断でProviderを重複実行しない。同じcontinuationの再提出は即時fail closedし、異なるstate/evidenceへ進んだ場合も既定2回を超えてStopを差し戻さない。

## Development Judgment

### 選択肢

1. 既存`judgment-host.ts`へ直接すべて実装する
2. 前段wrapperとProvider interfaceを追加する
3. Brainbase CoreへOpenAI APIを直接組み込む

### 採用

2を採用する。

- VALUE: 代理判断の縦切りを最短で証明できる
- SIMPLIFY: 既存監査Hostの責務を増やさない
- VALIDATE: 分類・Provider・basis検証・既存Stop委譲を独立テストできる

### 最強の反論

wrapper経由でない直接`dist/cli.js judgment:hook`利用者はAutonomy層を通らない。対策として、npmの公式`brainbase` binaryと新しい`judgment:install`出力をwrapperへ切り替え、既存installed configには再インストールを要求する。将来、実証後に既存Hostへ統合する余地を残す。
