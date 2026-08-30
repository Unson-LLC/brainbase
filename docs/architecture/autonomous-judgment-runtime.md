# Autonomous Judgment Runtime

Brainbaseの代理判断をCodex Hooksへ接続するruntimeである。Brainbase CoreはLLMを持たず、判断基準・過去Decision・委任境界の正本を担当する。意味判断は差し替え可能な`JudgmentIntelligenceProvider`が担当し、Codex利用時は独立したread-only Codex invocationを使う。

## 実行経路

1. UserPromptSubmit、PostToolUseは既存Judgment Hostへそのまま委譲する。
2. Stopが人間質問でなければ、既存監査Stopへ委譲する。
3. 明白な低リスク確認はLLMなしで`decision:block`と具体的な継続指示を返す。
4. 本番破壊、外部送信、購入・契約はHUMAN_REQUIREDとして既存監査Stopへ渡す。
5. 意味的なグレーゾーンでは、同一turnのBrainbase MCP結果とローカルSSOTから判断sourceを集める。
6. 収集したsourceだけを渡して独立Codex Resolverを呼ぶ。
7. Resolver出力のbasis、schema、人間境界をHostが再検証する。
8. 人間質問を通せるのは`HUMAN_REQUIRED`だけである。
9. NG/OK/条件付きOKは同一turnのWorkerへ実行指示として戻す。

## 有効化

ビルド後、Hook設定を再生成する。

```bash
brainbase judgment:install --target codex --dry-run
brainbase judgment:install --target codex --output ~/.codex/hooks.json
```

既存設定が`dist/cli.js judgment:hook`を直接指している場合は、Autonomy層を通らないため再インストールが必要である。新しい設定は`dist/autonomy-cli.js judgment:hook`を指す。

## Resolver設定

```bash
export BRAINBASE_JUDGMENT_RESOLVER_MODE=auto
export BRAINBASE_JUDGMENT_RESOLVER_MODEL=gpt-5.6-sol
export BRAINBASE_JUDGMENT_RESOLVER_TIMEOUT_MS=120000
export BRAINBASE_JUDGMENT_MAX_AUTONOMY_BLOCKS=2
```

`auto`/`codex`は独立Codex invocationを試す。`off`/`same-worker`は独立Resolverを使わず、グレーゾーンをメインWorkerへのBrainbase参照・安全続行指示へfallbackする。

## 安全境界

- Judgment decisionは外部操作の権限を付与しない。
- Resolverは空の一時directory・read-only sandbox・approval neverで動き、Packetはstdinで受け取る。
- Resolverが架空basis IDを返した場合は採用しない。
- AIの「権限がない」「秘密情報がない」という自己申告だけではHUMAN_REQUIREDを許可しない。
- 同一caseはimmutable decisionを再利用する。
- 同一質問の再提出はfail closedし、stateが進んだ場合も既定2回を超えて差し戻さない。
- Brainbase MCP eventのsecret系キーはResolverへ渡す前にredactする。
- continuation後も同じ不要質問を繰り返した場合はfail closedする。

詳細なStory、Architecture、Specは`.vibepro/spec/story-n4-autonomous-judgment-runtime/`を参照する。
