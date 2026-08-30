---
title: M2 Codex Proxy Judgment Loop Architecture
status: accepted
date: 2026-08-30
story_id: story-m2-codex-proxy-judgment-loop
governed_by: docs/architecture/judgment-dag-core.md
---

# M2 Codex代理判断ループ設計

## 決定

既存のUserPromptSubmit → PostToolUse → Stop episode lifecycleへ、監査finalizationより前に`Autonomy Gate`を追加する。Autonomy Gateは人間質問だけを対象に、決定論的二分類と意味的Resolverを分離する。Brainbase CoreはLLMを所有せず、意味適用の知能は現在のCodex Workerまたは差し替え可能な独立Resolver Providerから供給する。

```text
User request
  ↓ UserPromptSubmit
existing JudgmentReceipt + audit contract
  ↓
Codex Worker (current model)
  ↓ Stop: human question / completion
Autonomy Gate
  ├─ mode off / canary対象外 → existing audit finalization
  ├─ not a question / accepted clarification → existing audit finalization
  ├─ routine + reversible → deterministic continue; same Codex resumes
  ├─ human-only boundary → allow question; existing audit finalization
  └─ semantic gray zone
       ├─ provider absent → same Codex resumes and applies Brainbase judgments
       └─ provider present → independent read-only Resolver invocation
                              ↓ validated JudgmentDecision
                         continue / human_required
```

## 責務分離

### Brainbase Core

- Philosophy、Decision、precedent、scope、version、authority/delegationを正本として保持する。
- 適用候補の検索、active/superseded、scope、権限境界、根拠ID存在を決定論的に扱う。
- LLMを内蔵せず、モデルや認証へ依存しない。

### Codex Worker

- repository調査、実装、テスト、失敗時の探索を行う。
- P0ではStop差し戻し後に、同じ会話・コード・tool結果を保持したままBrainbase MCPを参照し、抽象的判断基準を具体caseへ適用する。
- Brainbaseの基準を作らず、既存基準の適用結果を作業計画へ反映する。

### Resolver Provider

- 意味的グレーゾーンだけを処理するオプション境界である。
- 同じCodex modelでも、別thread、別context、read-only sandbox、構造化出力、実装権限なしなら独立Resolverとして扱える。
- Provider返答は助言ではなく、case-boundな`continue | human_required`とinstruction patchを返す。P0 Hostはbasisの非空・構造を検査するが、entityの存在・scope・version readbackは独立provider adapterを接続する段階で追加する。

### Hook Host

- 人間質問の検出、決定論的risk分類、Provider呼出し、schema/case binding検証、Codexへの続行指示、既存監査finalizationへのhandoffを行う。
- Provider呼出しをepisode lock内で行わない。
- receiptを外部操作の権限として扱わない。
- `off | canary | on`をHost側で解決し、既定は`off`、canaryは明示project allowlistを必須とする。
- 質問本文を保存せず、digestとcase-boundな判定情報をimmutable autonomy receiptへ保存する。

## Autonomy Gate契約

1. 最終回答先頭の`🧠`、`📚`、`⚠️`監査行を除き、末尾の確認・選択・承認要求だけを候補にする。
2. 通常完了文や説明中の疑問文は対象外にし、明示的な人間行動要求を必要条件にする。accepted Judgment Receiptが`clarification.v1`を選んだ質問は遮断しない。
3. テスト、build、lint、read、search、local/reversible editは決定論的`continue`にする。
4. 外部送信・公開、本番操作、破壊、権限変更、機密/個人情報、購入/契約/支払、秘密情報/権限不足、新しいowner価値判断はfail-closedで`human_required`にする。レビュー済みrelease pipelineを元依頼が明示した場合だけ同じrelease操作の重複確認を省ける。外部message deliveryは常に人間境界へ残す。
5. 残りはsemantic gray zoneである。Provider未設定時は同じCodexへBrainbase参照と判断適用を命令する。Provider設定時だけ独立推論を呼ぶ。
6. `continue`はNG理由だけでなく、cancel、do_next、acceptance_criteriaを必須にする。
7. Providerのcase ID不一致、schema不一致、`continue`なのにinstruction patchなし、`human_required`なのにhuman questionなしはfail-closedにする。

## Lockと再入

Autonomy caseに必要なepisode snapshotはturn lock内で読み、lockを解放してからProviderを呼ぶ。Provider結果を使う時点でturn/final stateを再確認する。P0のpure classifierはnetwork/LLMを呼ばない。

既存Codex Stopの`stop_hook_active`はbounded repairを表す。初回のAutonomy `continue`は一度だけCodexを再開し、再開後も同じ人間質問を返した場合は`judgment_autonomy_continuation_exhausted`でfail loudする。Autonomy続行指示には既存audit contractを満たして終了する条件を含め、監査repairとの無限往復を作らない。

## Provider差し替え

```ts
export type JudgmentAutonomyResolver = (
  request: JudgmentAutonomyResolverRequest
) => Promise<JudgmentAutonomyResolverDecision>;
```

- `same_codex`: Providerなし。Hook block reasonを継続promptとして現在のCodexが再推論する。
- `codex_readonly`: 後続adapter。隔離`CODEX_HOME`、hook無効、read-only sandbox、ephemeral thread、JSON schema output。
- `managed_api`: 後続adapter。組織側API契約で実行する。
- `local_model`: 後続adapter。同じcontractを満たす限り利用可能。

Brainbase OSSは特定providerを必須依存にしない。

## Rollout

最初の本番導入はBrainbase projectだけを対象に`canary`で24時間実施する。顧客project、契約、請求、人事、本番データ操作は対象外である。exact release HEAD、Hook lifecycle、Brainbase参照、audit/final/autonomy receipt、full regression、VibePro Gate、24時間readbackが揃うまで全体`on`へ昇格しない。

## 非目標

全ツールの事実台帳、一般ハルシネーション検出、外部操作の自動承認、判断sourceの自動昇格、managed SaaS、provider課金管理はこのStoryに含めない。
