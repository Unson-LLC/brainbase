---
story_id: story-knowledge-formalization-language
title: 知識昇格を内部概念に限定し利用者向け操作を具体化する
status: active
---

# 知識昇格を内部概念に限定し利用者向け操作を具体化する

## 背景

Brainbaseでは `promotion` が、候補の承認、Graphへの登録、Skillへの反映など複数の遷移を指している。利用者向け画面でも「承認」「反映」「昇格」とだけ表示すると、何が正本になり、何がまだ別工程なのか分からない。

## Acceptance Criteria

- [x] AC-001: `learning` の既存 `promotion` 状態・APIは互換性のため維持する。
- [x] AC-002: `inbox-service` と `learning-candidate-modal` では「何から何へ移すか」が分かる具体的な操作名を表示する。
- [x] AC-003: `mana-chat-view` と `learning-candidate-modal` では、候補の承認をGraph登録や本番反映の完了として表示しない。
- [x] AC-004: `learning-cli` の文書契約テストにより、Graph、所有repo／Drive、Skill、DAG／Gateの正本境界を一意に確認できる。
- [x] AC-005: `learning-cli` と `learning-candidate-modal` では、曖昧な「反映」「昇格」を具体語へ置き換える。
- [x] AC-006: `learning-candidate-modal` では、異なる保存先や分類待ちを一つの一括操作で処理しない。
- [x] AC-007: `learning-cli` と `learning-candidate-modal` はlegacy Wiki候補を書き込まず、分類待ちの理由を表示する。

## 対象外

- 内部status、DB列、API pathの名称変更
- 新しい正本や新しい昇格パイプラインの追加
- 承認後のGraph登録や本番デプロイの自動化
