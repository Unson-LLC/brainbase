---
story_id: story-knowledge-lookup-plan-binding-v1
title: AIが言い直した質問と付けた試行名のまま、読んだ根拠で取得を終えられる
status: implemented
implementation_started: true
owner_repository: brainbase
---

# 利用者成果

知識を必要とする利用者として、AIが自分の言葉で言い直した質問と、自分で付けた試行名のまま、実際に読んだ根拠で取得を終えたい。

## 変更方針

SIMPLIFICATION。既存の固定と照合の規則を、利用側のHostが実際に満たせる形へ作り直す。新しい状態キーや結果の種類は足さない。

## 受入条件

- AC-01: 質問はrequired_fieldsと同じく、初回の有効な計画で固定する。Hostが最初に持つ依頼文と一字一句同じである必要はない。固定した後の変更は引き続き拒否する。
- AC-02: 不正な初回の計画では、質問もrequired_fieldsも固定しない。空の質問は `question_invalid` として区別する。
- AC-03: 試行は、その呼び出しのattempt_id（無ければtool ID）で識別する。finishのfield_evidenceは、その値で実際のreadと照合する。
- AC-04: lookupのfinish応答は、取得を行わない提案のままにする。missing_fieldsには、根拠を挙げていない必須欄だけを示す。
- AC-05: Hostの案内に、固定の規則と、根拠に挙げるattempt_idを書く。

## 調査

利用側のHostでは、生の依頼文（システム側の付記を含む）がHost状態の質問になっていた。そのため、モデルが言い直した質問は、初回から `question_changed` で拒否された。モデルが付けたattempt_idは記録されず、それを根拠に挙げたfinishは `required_field_not_retrieved` で拒否された。Graphifyによる影響は未確認（unknown）とし、実装と関連テストを直接確認した。

## 検証

- 関連2ファイルの35テストと型検査が成功した。
- 本番への反映は、利用側Hostの依存更新と、Claude CodeでのPreToolUseの登録につながる。
