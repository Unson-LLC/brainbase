---
title: M2 Codex代理判断ループ仕様
status: accepted
story_id: story-m2-codex-proxy-judgment-loop
architecture: docs/architecture/story-m2-codex-proxy-judgment-loop.md
date: 2026-08-30
---

# M2 Codex代理判断ループ仕様

## 公開契約

`src/judgment-autonomy.ts`は副作用なしで、人間質問抽出、決定論的境界判定、Resolver request/decision、instruction patch、続行文生成を公開する。`JudgmentHostOptions`は任意の`autonomyResolver`、`autonomyMode`、`autonomyCanaryProjects`を受け取れる。安全な既定値は`off`である。有効化後にProviderを指定しない動作は、現在のCodexを再開してBrainbase判断を適用させる。

## 受け入れシナリオ

### AC-001 人間質問の抽出

Autonomy Gateは最終回答先頭の既存監査行を除外し、末尾にある明示的な確認・選択・承認要求だけを抽出する。通常の完了文は`not_applicable`となり、accepted Judgment Receiptが`clarification.v1`を選んだ質問は`human_required`として既存Stop finalizationへ渡す。

### AC-002 通常工程の自走

「テストを実行しますか」「ファイルを読んでよいですか」「ローカル修正を進めますか」等は`routine_reversible_work`としてLLMを呼ばず`continue`にする。instruction patchは質問中止、次の実行、失敗時の安全な代替、同一ターン続行、既存audit contractを完了条件に含む。

### AC-003 人間専用境界

外部送信・公開、本番操作、破壊、権限変更、機密/個人情報、購入・支払・契約・法的コミット、取得不能な秘密情報/権限、既存基準から導けない新しいowner価値判断は`human_required`にする。レビュー済みrelease pipelineを元依頼が明示した場合だけ、同じrelease操作の重複質問を`continue`にできる。外部message deliveryは明示依頼があっても最終確認を残す。Autonomy判断は外部操作を実行せず、既存permission boundaryを迂回しない。

### AC-004 意味的グレーゾーン

決定論的二分類に入らないA/B選択等はsemantic gray zoneとする。Providerなしの場合は`source: same_codex`で`continue`を返し、現在のCodexへBrainbase MCPから目的・判断基準・過去Decision・委任境界を取得してOK/NGを決め、NG時は代替行動と完了条件まで適用するよう指示する。Providerありの場合だけ一度呼び出す。

### AC-005 Resolver binding

Resolver requestはschema version、case ID、turn ID、task request、人間へ出そうとした質問、project、selected DAG、human-only policyを含む。Resolver decisionは同一case ID、schema、verdict、reason、basisを必須とし、`continue`にはinstruction patch、`human_required`にはhuman questionを必須とする。不一致またはbasis空はmachine-readable errorで拒否する。P0ではbasis entityの存在・scope・version readbackまでは保証しない。

### AC-006 Stop統合

HostはStop時にAutonomy Gateを既存audit finalizationより前に実行する。既定`off`では既存動作を変えない。`canary`では明示allowlistのprojectだけ、`on`では全projectで評価する。`not_applicable`と`human_required`は既存finalizationへ進む。`continue`はimmutable autonomy receiptを保存し、`decision:block`で現在のCodexへinstruction patchを返す。`stop_hook_active=true`で再度`continue`となった場合は`judgment_autonomy_continuation_exhausted`としてfail loudし、無限loopを作らない。

### AC-007 回帰

既存episode、PostToolUse event、owner audit、knowledge capability、answer body preservation、final receiptのschemaと意味を変更しない。既定off、単一project canary、receipt、adversarial fail-closed、追加unit、`tests/judgment-host.test.ts`のStop integration、build、typecheck、full regressionをrepository exact HEADで成功させる。実Codex同一ターン再開と24時間readbackまではStoryをactiveに保つ。

## エラー

- `judgment_autonomy_resolver_invalid`: schema、case ID、verdict、reason、basisが不正。
- `judgment_autonomy_resolver_instruction_missing`: `continue`にinstruction patchがない。
- `judgment_autonomy_resolver_authority_expansion`: Resolverの`do_next`が外部・破壊的・material commitment境界を越えようとした。
- `judgment_autonomy_resolver_human_question_missing`: `human_required`に人間へ提示する質問がない。
- `judgment_autonomy_continuation_exhausted`: 一度の続行後も同じ種類の不要な人間質問を繰り返した。

## 非目標

Brainbase CoreへのLLM組込み、Codex CLI/SDK adapterの強制、一般的な内容正誤判定、全tool evidence ledger、外部操作の自動承認、判断source自動昇格は含めない。
