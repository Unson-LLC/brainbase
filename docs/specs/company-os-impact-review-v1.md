# Company OS Impact Review v1

## 目的

採用済みのObjective、World Model、Constraint、判断方法の版が変わったとき、どの実行計画を再確認すべきかを、読み取り専用の逆引きと不変の参照で明示する。影響評価は実行権限、資源確約、予約、外部作用を変更しない。

## 入力と境界

`CompanyOsImpactReviewCoordinator.review` は、変更候補と現在の参照を `ImpactReviewCurrentReferencePort` で検証し、解決できた変更だけを `ImpactReviewIndexPort` に渡す。現在の版・ダイジェストを読み取れない変更は「影響なし」とせず `unresolved_changes` に残す。世界モデルの関係（`uses_as_input`、`predicts`、`adopted`、`applies_to`）と実行順序の関係（`execution_depends_on`、`selected_method`）は、同じ `depends_on` に潰さない。

逆引きは `ImpactReviewAffectedPlan` を返すだけで、計画、Problem snapshot、run、Reservation、ExecutionAuthority を直接変更しない。権限やConstraintの判定は実行機構の正本に委譲し、参照時点の状態として受け取る。

## 判定

- `stop`: 権限が期限切れ・取消済み、またはConstraintが違反・期限切れ。新しい実行を許可せず、補償操作や過去の外部作用の取消は行わない。
- `hold`: 重要な前提の変更・反証、権限/Constraintの不明、外部作用の不明。決定的な`wait_id`でDurable Waitを作り、担当者と期限を保持する。外部作用不明は`reconcile_external_effect`として扱い、再判断へ直行しない。
- `continue`: 軽微な変更で、現行の権限とConstraintが有効。完了済み計画は履歴を不変のまま残し、過去の効果を取消扱いしない。

通知は変更・計画・判定・根拠参照から決定的に計算したIDで保存する。同じ内容の再試行は既存通知を返し、通知やWaitを二重作成しない。通知sidecarは参照、理由、時刻だけを保持し、Canonical Objective/Model/Constraintの本文を複製しない。

## 再判断

`reassess` は、完了済み計画または外部作用不明の計画を上書きしない。現在の参照を再検証したあと、`ImpactReviewRejudgmentPort` に新しいProblemとrunの作成を依頼する。既存のwaitを指定した場合は、Durable Waitの`markPremiseChanged`と同じ形で新しいProblem参照を履歴へ追加する。Reservationの取消、実行の補償、過去runの書換えはこのSpecの範囲外である。

## 実装と統合

Story 13のDurable Wait、Story 14のLearning Adoptionが未mergeでも、OSSのビルドが壊れないようにportを構造的に定義する。各統合先は、公開された型と契約をアダプターで接続し、旧記録を上書きしない。既存StoryのACをこのSpecの都合で縮小しない。
