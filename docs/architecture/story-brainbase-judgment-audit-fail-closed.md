---
story_id: story-brainbase-judgment-audit-fail-closed
title: Judgment audit fail-closed architecture
status: accepted
---

# Architecture: Judgment audit fail-closed

## Decision

Judgment Resolverの運用状態を、`installed`、`trusted_current`、`ready_for_fresh_task`、`proven_active`へ分離する。静的なHook定義や過去のepisodeは稼働証明に使わない。

`scripts/check-codex-judgment-hook-readiness.mjs`は新しいCodex app-serverへ接続し、Codex公式`hooks/list`の実効状態を検査する。Brainbaseはprivateなhash計算を再実装せず、trustを書換しない。4イベントが現在のidentityに対して`trusted`または`managed`である場合だけ`ready_for_fresh_task`を返す。

最終的な`proven_active`は、trust承認後に作成した新規Desktop task自身のepisode、final receipt、transcript先頭の保存済み監査行を同一turnへ束縛したlive E2Eだけが証明する。

## State model

```text
installed
  -> trust_required       current Hookがmodified/untrusted/missing
  -> trusted_current      Codex hooks/listがtrustedまたはmanaged
  -> ready_for_fresh_task 静的readiness完了
  -> proven_active        新規taskのepisode/final/transcriptが一致

any invalid Stop state -> failed_visible
```

`ready_for_fresh_task`から先は自動承認しない。ownerがCodexの`/hooks`で変更内容を確認して承認し、新規taskを作る。新規taskで失敗した時だけDesktop Hostのreload/restartを追加で切り分ける。

## Components

### Readiness checker

- Codex app-serverをstdioで起動し、`initialize`後に`hooks/list`を呼ぶ。macOSではDesktop同梱実体を優先し、Rosetta NodeからPATH上のuniversal wrapperを起動した際のarchitecture誤選択を避ける。
- `UserPromptSubmit`、`PostToolUse`、`PostToolUseFailure`、`Stop`にcanonical entrypointが各1件あることを確認する。
- 4件が同じcommandを使い、enabledで、errorなしであることを確認する。
- `PostToolUse`は`^mcp__brainbase__.*$`だけを対象にする。
- `modified`、`untrusted`、missingは`trust_required`として非zeroにする。
- JSON出力にraw `trusted_hash`や秘密情報を含めない。

### Stop fail-closed

- identityがないStopは`judgment_episode_identity_missing`。
- 対応episodeがないStopは`judgment_episode_not_found`。
- required knowledgeまたはowner監査prefixが不足する最初の修復可能なStopは`decision: block`で1回だけ継続し、final receiptを作らない。なお不完全なactive再Stopは`judgment_stop_repair_exhausted`で非zero終了し、無限再生成を防ぐ。
- 監査prefix比較は行末の空白・tabだけを正規化し、本文・順序・multiplicityはexactに保つ。
- 参照必須でなくeventが0件なら、Host-ownedの`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`をrequired audit lineへ追加する。
- orphan PostToolUseは証拠を捏造しないため引き続きignoreする。
- complete Stopとそのreplayは従来どおりexactly-one complete finalへ収束する。

## Evidence boundary

readiness checkerは現在のCodex設定とtrustだけを証明し、現在開いているtaskでの実行を証明しない。live E2Eは対象episodeとtranscriptを同じsession/turnへ束縛し、Hook/config変更より後に作成されたtaskであることを確認する。

## Rejected alternatives

- `config.toml`にtrust sectionがあるだけでtrustedとみなす。
- Brainbaseが`trusted_hash`を生成・更新する。
- entrypointをshellから直接実行した結果をDesktop activationの証拠にする。
- journalなしで`🧠`行をmodelへ生成させる。
- repeated Stopを`incomplete` finalで通過させる。
