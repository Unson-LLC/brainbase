# 外部Claude向けJudgment Hookアダプター

## 決定

Brainbase MCP HTTP serverへ認証必須の `POST /host/judgment/hook` を追加する。受け取ったClaude Code Hook payloadは、Codexが利用している `processHookPayload` へそのまま渡す。判断・監査・journal・Stop gateの実装は複製しない。

## 信頼境界

- 既存 `/host/judgment/resolve` はloopback Codex互換のため変更しない。
- 新入口は `MCP_HTTP_BEARER_TOKEN` のBearer認証を必須にし、認証前にbodyを読まない。
- bodyは1 MiBを上限とする。JSON object以外、未対応event、欠落または不正なproject codeは400にする。
- Host側が生成したsession/turn identityを正本とし、Brainbase binding secretは外部Hostへ渡さない。
- 正常応答は `schema_version`、`accepted`、event、session、turn、canonical Hook出力を束縛したenvelopeとする。
- `UserPromptSubmit`はcanonical episodeの`initial_route_receipt.resolution_id`を`receipt_id`、`initial_route_receipt_digest`を`route_resolution_sha256`として返す。外部Hostは表示用contextからdigestを再生成しない。
- `UserPromptSubmit`のreceipt ID欠落またはdigestが64桁の小文字hexでない場合は503にする。
- `PostToolUse`はcanonical出力の非空`systemMessage`を監査記録receiptとして要求し、未記録なら503にする。
- Hook結果がblockまたは内部例外ならHTTP成功へ丸めず、外部Hostがfail closedに扱える契約を返す。

## データフロー

`Claude Hook -> Cloudflare synthetic proxy -> authenticated /host/judgment/hook -> processHookPayload -> Resolver/journal -> canonical output + route receipt metadata -> Hook response`

## 非対象

- 外部Hostへの行動権限追加
- Judgment Resolver DAGの再分類
- Codex Hookの置換
