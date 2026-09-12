---
spec_id: SPEC-story-judgment-harness-degraded-operation
story_id: story-judgment-harness-degraded-operation
development_mode: SIMPLIFICATION
---

# Judgment harness縮退運転仕様

## 不変条件

- INV-1: Judgment receiptはaction authorizationではない。
- INV-2: Host、journal、Node、module loadの障害だけを理由にCodexの通常権限を拒否しない。
- INV-3: `audit_degraded`を`managed`、完全監査、作業成功として表示しない。
- INV-4: 正常に開始したepisodeの既存契約と有限Stop修復は変更しない。
- INV-5: 生のprompt、秘密値、stack、内部pathを障害出力へ含めない。

## 振る舞い

- SPEC-1: `UserPromptSubmit`中の安全に分類可能な例外は、診断を可能なら保存し、`continue:true`と監査未完了contextを返す。
- SPEC-2: 同じturnの検証済みstart-failure markerがある`PreToolUse`は空のHook応答を返し、通常のCodex権限へ委ねる。
- SPEC-3: 同じturnのstart-failure markerがある`Stop`は有限の警告だけを返し、回答をblockしない。
- SPEC-4: Node不在またはmodule import失敗は、event種別にかかわらず空のHook応答と安全なstderr診断を返し、exit 0にする。
- SPEC-5: `BRAINBASE_JUDGMENT_START_FAILURE_MODE`と`BRAINBASE_JUDGMENT_CANARY_CWD`を縮退運転の前提にしない。
- SPEC-6: `PostToolUse`の監査保存がHost・journal等の基盤障害で失敗した場合は監査未完了を通知してexit 0にする。改ざんや不正な委任元など、監査基盤障害ではない整合性違反は拒否を維持する。

## 検証

- Host接続拒否、不正応答、timeout、journal保存失敗でSPEC-1〜3とSPEC-6を確認する。
- Node不在とmodule import失敗でSPEC-4を実エントリーポイントから確認する。
- 正常開始の既存integration/unit suiteでINV-4を確認する。
- Graphifyは`missing_graph`のため影響範囲はunknown。Host入口、start-failure integration、readiness checkerをコードで直接確認する。
