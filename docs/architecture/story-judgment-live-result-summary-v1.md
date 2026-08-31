---
story_id: story-judgment-live-result-summary-v1
title: Judgment live result summary architecture
status: accepted
updated_at: 2026-08-29
---

# Architecture: Judgment live result summary

## 境界

PostToolUse Hostは、query/targetを従来どおりtool inputから生成する。tool response本文は表示へ転載せず、Brainbase retrieval auditの既知の終端語だけを分類して、Host自身の定型文へ変換する。

```text
tool input ──> Host生成query_excerpt
tool response ──> validated final envelope classifier ──> search|retrieve + no_result|result | unknown
query_excerpt + operation + outcome ──> Host生成event_kind / display_line
```

## 安全契約

- `検索`／`取得`、`該当なし（不在確定ではない）`、`結果を取得` は、Brainbase tool responseの最終content blockにある固定3行のretrieval audit envelopeだけから一体で認識する。
- 固定envelopeを認識できた場合は、そのoperationをevent kindへ採用する。これにより`resolve_entity`とquery付き`list_extension_entities`を含むMCP正本の全retrieval targetをproducer契約と一致させる。
- 応答中のquery、件数、識別子、本文は保存displayへ転載しない。
- 固定envelopeを認識できない場合だけ、従来のtool名によるevent kind、構造化count、または「正常応答を確認」へfail closedする。
- route、write、failure、episode lifecycleには分岐を追加しない。

## Stop Hookとアプリ後段メタデータの境界

- `answer_digest`はStop Hookが実際に受け取った最終回答を結合する。
- Codex transcriptには、Stop Hook確定後にアプリが末尾へ`<oai-mem-citation>...</oai-mem-citation>`を付与した最終回答が保存される場合がある。
- live E2Eは監査行を含むtranscript本文を先に検証し、末尾にある完全なmemory citation blockだけを除外してHook可視本文を復元する。途中の同名文字列や不完全blockは除外しない。
- Host runtime、保存済みepisode、memory citation本文は変更しない。

## required capabilityの実行結果境界

- `required_capabilities`が要求するのは、許可された正規toolをそのturnで実行し、真正なPostToolUse eventへ結合することである。参照先の選定成功そのものではない。
- `knowledge.resolve`のeventは、応答の成功・失敗と独立に`knowledge.resolve`を実行済みとして記録する。`success`、`safe_metadata`、`display_line`は実応答の意味を保持し、失敗・unconfirmed・参照先なしを成功や取得済みへ変換しない。
- Stopは実行済みeventがあるcapabilityを再要求しない。これにより、修復tool callでevent setが変化し、ownerが提示すべき監査prefixも後から変わる循環を防ぐ。
- owner監査行または回答本文が不足する場合だけ、確定済みevent setを前提に既存のone-shot修復を使う。active再Stopをさらに修復する回数は増やさない。

## rollback runtime境界

この境界は独立したruntime機能ではなく、上記Host契約をglobal Hook、共有local UI/MCP、Lightsailへ同一commitで反映するためのrelease safety境界である。Host変更と分離すると、修正済み監査契約を安全に配備・復元できないSHA分岐が生じるため、同一PR・同一merge SHA・同一fresh-task readbackで検証する。

- `/Users/ksato/workspace/repos/brainbase`はsource repositoryとしてのみ扱い、dirtyな利用者checkoutをswitch、reset、clean、stashしない。
- local UIとMCPは共有するdisposable runtime `/Users/ksato/workspace/repos/.runtime/brainbase-31013`だけを更新する。
- 通常時は`origin/develop`の取得済みcommitをtargetにする。rollback時はowner-only pin file `/Users/ksato/workspace/var/brainbase-runtime-pinned.sha`のfull SHAを優先し、launchd start/updateの両方が同じresolverを使う。
- source root欠損、Git root不一致、pinの非regular file、full SHA以外、commit未取得はfail closedし、欠損rootをcleanとみなさない。
- launchd再起動後のreadinessは固定sleepや単発probeを使わず、bounded pollingでAPIが対象full SHAかつ`dirty=false`を返し、runtime worktreeのHEADが対象SHAと一致しcleanであることを同一runで確認する。上限到達、SHA不一致、dirty、未応答は明示non-zeroで終了し、MCP・Lightsail・Hook復元など後続面へ進まない。
- readinessの各HTTP probeは、検証済みの有限正数を`--connect-timeout`と`--max-time`へ渡す。local UI/MCP helper、Lightsail instance内probe、Lightsail public probeの全curl呼出しに適用し、1回のcurl停止がbounded pollingを無期限化しないようにする。timeout値が欠損・不正・非有限・0以下ならfail closedし、probe timeoutは成功扱いせず既存retryと最終non-zero timeoutを通る。
- global Hookは独立したclean deployment checkoutを使い、rollbackは保存済みHook設定を最後に復元する。dirtyな正本checkoutをHook checkoutとして切り替えない。

## 検証

単体テストでMCP正本の9 retrieval target、動的operation、0件、結果取得、偽の件数・queryを固定し、live-session E2Eで実MCP応答と保存eventの意味一致、およびアプリ後段メタデータを除いたHook可視本文とreceiptの結合を検証する。rollback resolverは一時Git repositoryを使い、valid pinの保持、不正pin、欠損rootを実行テストする。
