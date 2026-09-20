# Stop internal repair visibility spec

## Problem

Codex DesktopはStop hookの`decision:block`に含まれる`reason`を、モデル向けの再開入力である`<hook_prompt>`として会話へ投影する。このため、監査証拠だけを補う内部手順でも利用者に長い修復文が見える。

## Behavior

- `BRAINBASE_JUDGMENT_VISIBLE_PROTOCOL_REPAIR=disabled`のruntimeでは、`stop_decision.business_decision === "RELEASE"`の場合、`protocol_status === "repair"`だけを理由にStopをblockしない。
- 未充足のprotocol capabilityをfinal receiptの`missing_capabilities`へ保存し、`completion_status`を`audit_degraded`、`protocol_status`を`audit_protocol_incomplete`とする。
- Hostは既存の監査表示に`監査縮退`を加えた`systemMessage`を返す。モデルへ再生成を要求する`reason`は返さない。
- `business_decision === "CONTINUE"`は引き続きblockする。安全な実作業の継続と監査修復が同時に必要な場合、block理由へ両方を含める。
- `ASK_HUMAN`のfinalizationと既存の権限境界は変更しない。
- 環境変数を設定しないruntimeは移行互換のため従来の一回修復を維持する。

## Verification

- node evidence不足だけのStopがblockせず、`audit_degraded`で確定する。
- fake/failed evidenceも成功扱いせず、同じく不足をfinalへ保存する。
- 未完了の実作業を検出する既存テストが引き続き`decision:block`を確認する。
