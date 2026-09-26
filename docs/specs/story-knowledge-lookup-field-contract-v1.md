# 知識取得入力契約

- `required_fields`は既存APIの許可root、禁止root、長さ・件数・path規則を共通で検証してからHost状態へ保存する。
- 不正な初回入力はrequired_fieldsを固定せず、実取得の試行回数を消費しない。有効な条件の変更は引き続き拒否する。
- `finish`はstatus、assessment、reference_ids、field_evidence、unresolved_itemsと非空termination_reasonを必要とする。Hostで欠落を拒否する。
- satisfiedの判定には同一取得計画で実読取した参照と各必須fieldの根拠が必要。入力修正は充足の代替ではない。
- 回帰テストは不正入力後の有効read準備、固定条件の変更拒否、finish欠落、実読取からのsatisfied、既存権限と予算を対象にする。
- 過去の不正状態は成功扱いへ書き換えない。新規計画での正しい取得を可能にし、一般的な履歴移行機構は追加しない。
