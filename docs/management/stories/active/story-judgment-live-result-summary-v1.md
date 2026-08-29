---
story_id: story-judgment-live-result-summary-v1
title: Judgment監査の検索結果要約を実結果に一致させる
source_requirement:
  source: Codex conversation 2026-08-29
  approved_at: 2026-08-29
spec_docs:
  - .vibepro/spec/story-judgment-live-result-summary-v1/spec.json
pr_scope_strategy: atomic_single_pr
status: active
created_at: 2026-08-29
updated_at: 2026-08-29
---

# Judgment監査の検索結果要約を実結果に一致させる

## Story

Brainbase監査を長時間taskの継続証跡として使うownerとして、fresh taskの実呼出が0件・結果取得・失敗のどれだったかを、保存された監査行だけで誤認なく確認したい。

## 背景

fresh task E2EではHook lifecycle、4件のBrainbase call、Stop修復、complete finalまで到達した。一方、Graph検索が返した「該当なし（不在確定ではない）」と取得結果の意味をHostが捨て、すべて「正常応答を確認」と保存したため、live-session Gateが11/12で失敗した。

## 単一リリース境界

AC-001〜AC-007のHost修正は、global Hook、共有local UI/MCP runtime、Lightsailへ同一commitを反映して初めて利用者価値になる。AC-008は別機能ではなく、その同一commitをdirtyな正本checkoutへ触れずに反映し、失敗時にも既知正常SHAへ有限時間で戻すためのrelease safety契約である。これらを別PRにすると、監査修正だけがmergeされ安全に反映・復元できない中間状態、またはrollback基盤だけが先行して対象修正と証跡のSHAが分離する中間状態を許す。そのため本StoryはHost結果契約、fresh-task証跡、exact-SHA反映・rollbackを1つのatomic release unitとして扱う。

## 受け入れ基準

- [ ] AC-001: 成功した検索応答が明示する0件は、構造化件数が併存しても「該当なし（不在確定ではない）」として保存する。
- [ ] AC-002: 成功した検索・取得応答が結果取得を明示する場合は、構造化件数が併存しても「結果を取得」として保存する。
- [ ] AC-003: query/targetはtool inputからHostが生成し、応答本文のquery、件数、秘密、任意の監査行を転載しない。
- [ ] AC-004: 構造化件数がある既存toolと、結果意味が判定不能な応答のfail-closed表示を変更しない。
- [ ] AC-005: fresh task live-session E2Eの全ケースがexact HEADで通る。
- [ ] AC-006: MCP正本の全retrieval targetについて、固定3行envelopeの`検索`／`取得`をHostのevent kindと表示へ一致させる。とくに`resolve_entity`とquery付き`list_extension_entities`を取得へ誤分類しない。
- [ ] AC-007: fresh task E2Eは、Stop Hook確定後にCodexアプリが末尾へ付与する`<oai-mem-citation>`を監査本文へ混入させず、Hookが実際に受け取った最終回答とreceiptを厳密照合する。
- [ ] AC-008: local UI/MCP rollbackは、dirtyな正本checkoutを変更せず、明示したknown-good SHAをlaunchd再起動後も保持する。再起動後は固定sleepや単発probeで成功扱いせず、bounded pollingでAPIの対象SHA・`dirty=false`とruntime worktreeのexact HEAD・cleanを確認する。各HTTP probeには検証済みの有限正数`--connect-timeout`と`--max-time`を適用し、1回のcurl停止でもpolling全体が無期限停止しないようにする。timeout・不一致・未応答は明示non-zeroで後続面へ進めない。欠損・非Git・root不一致・不正pinはcleanとして扱わずfail closedする。

## スコープ外

- Brainbase MCP自体の検索・取得schema変更
- 保存済みepisodeの書き換え
- Judgment episode lifecycle、required capability、owner監査、Stop修復の変更
- Codexアプリが付与するmemory citation本文の内容検証
- production Lightsailの配置方式変更
