---
story_id: story-canonical-graph-foundation-history-v1
title: 組織Graphの判断定義を過去版と現在の権限で参照する
status: in_progress
---

組織の判断者として、Graphに保存したObjective・Variable・Model・Constraintと哲学を、実際に固定した版で再読込したい。

受入条件:
- AC-01: 同じGraph DB内の追記専用履歴に保存する。既存の可変versionは不変版とみなさない。移行前の未保存版は復元しない。
- AC-02: Graphの各writerによる更新もDB境界で履歴を保持する。削除・再作成で過去版を再利用しない。
- AC-03: 旧版の読取は現在行のRLS・scope・ACLに従う。履歴だけにアクセスして迂回できない。
- AC-04: Foundationは共通定義とdigestを検証する。哲学は既存payloadに明示された適用範囲と期間を固定し、欠落時は利用不可とする。
- AC-05: 共通公開providerから同じreaderを利用できる。隔離DBで改訂・取消・改ざん・旧版・migration再実行を検証する。

参照: docs/architecture/foundation-public-provider.md、Organization repository boundary ADR。

## 検証と配備境界

PGlite上の実SQLからtransaction-bound reader、共通HTTP providerまで、定義と哲学の特定版読取・digest・現在ACL取消・project移動を検証する。移行SQL自体は別のテストで再実行・改訂・直接改変拒否を確認する。

本番DB移行とruntime配備はこのStoryのローカル検証とは別の結果として記録する。既存Ontology 1.1.0の書込型を追加せず、今回の公開面は共通契約の読取・参照検証である。未接続のObservation等を含む判断一式は不足を返す。
