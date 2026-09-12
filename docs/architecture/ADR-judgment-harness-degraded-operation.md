# ADR: Judgment harnessを実行権限から分離する

## 状態

採用（2026-09-12）

## 問題

Judgment Hostは判断経路と監査証跡を提供するが、操作権限そのものは提供しない。それにもかかわらず、Host通信、journal、Node入口の故障時にHookが`continue:false`または`permissionDecision: deny`を返すため、監査基盤の故障がCodex本体の診断と復旧を止めていた。

## 決定

Judgment harnessを次の2状態で扱う。

1. `managed`: Hostとjournalが正常。既存のepisode、required capability、Stop監査契約を適用する。
2. `audit_degraded`: Hostまたは入口を確認できない。完全監査を主張せず、通常のCodex権限と承認へ制御を戻す。

`audit_degraded`は操作許可ではない。Brainbaseのreceiptも操作許可ではない。書込み、外部操作、削除、本番操作の許否は、どちらの状態でもCodexの既存権限・承認境界が決める。

## 障害境界

```text
利用者の依頼
   |
   +--> Codexの権限・承認 ------------------> 実行
   |
   +--> Brainbase Judgment harness --> 判断・監査
              |
              +-- 正常: managed receipt
              +-- 故障: audit_degraded警告
```

監査側の故障線は、実行権限の線を切断しない。正常なmanaged episode内で契約違反が起きた場合の有限Stop修復は維持する。

## 却下した案

- canary cwdを増やす: 設定自体が新しい単一障害点になる。
- 診断tool名のallowlistを持つ: shell引数や複合コマンドを完全には判定できず、判断receiptを実行権限へ混入させる。
- Hostを二重化するだけ: 可用性は上がるが、監査障害が実行を停止する結合自体は残る。

## ロールバック

本変更のcommitをrevertすると旧fail-closed入口へ戻る。journal schemaと正常episode schemaは変更しないため、データmigrationは不要。
