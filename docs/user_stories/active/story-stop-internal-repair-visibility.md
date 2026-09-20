---
story_id: story-stop-internal-repair-visibility
title: Stopの内部修復指示を会話へ表示しない
status: active
created_at: 2026-09-20
---

# Stopの内部修復指示を会話へ表示しない

Brainbaseの監査証拠だけが不足しているとき、利用者には完成した回答だけを返し、Hostとモデル間の修復手順を`<hook_prompt>`として会話へ表示しない。実作業が未完了の場合と、人間の承認が必要な場合の停止は維持する。

## 受入条件

1. 業務判断が`RELEASE`で監査プロトコルだけが不足したStopは`decision:block`を返さず、回答本文を再生成しない。
2. 不足した監査能力はfinal receiptへ`audit_degraded`として残し、Hostの`systemMessage`で監査状態を表示する。
3. 実装・操作の安全な残作業がある`CONTINUE`は従来どおり有限回の`decision:block`を返す。
4. `ASK_HUMAN`、権限境界、外部影響の判定は変更しない。
