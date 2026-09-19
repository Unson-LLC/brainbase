---
id: story-astra-instruction-simplification
title: 必要な指示だけで作業を完了できる
status: active
---

# 必要な指示だけで作業を完了できる

利用者として、SkillsとAGENTS.mdの重複や一律の手順による読み込み・不要な停止を減らし、依頼に必要な調査と検証を完了してほしい。

## 受け入れ条件

- AGENTS.mdとCLAUDE.mdは同一で200行以内。権限、正本、既存変更の保護、完了と証拠の境界を維持する。
- 変更するSkillは起動条件が具体的で、無関係な文書や固定数のエージェントを一律に要求しない。
- 詳細は必要な場合の参照先へ分ける。Sol/Lunaを含む利用者にも通じる明示的な入出力・成功条件を残す。
- カタログ監査、変更前後の量、既存検証、未変更範囲と実測していない効果を記録する。
- 別作業のdirty変更と配布された個人Skillsを上書きしない。

## 開発モード

SIMPLIFICATION。直近のStory履歴には旧runtime操作と未使用MCPの削除がある一方、常時指示とデバッグSkillに重複・固定手順が残る。新しい制御機構を追加せず削除・統合・必要時参照を選ぶ。読み込み量の削減は計測できるが、実際の成功率・処理時間は未測定。

## 参照

- [Spec](../../specs/story-astra-instruction-simplification-spec.md)
- [OpenAI記事](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
