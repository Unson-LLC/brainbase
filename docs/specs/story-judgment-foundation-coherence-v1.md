# 判断Foundation参照整合 v1 Spec

## 対象

`JudgmentProblem`の標準Foundation reference providerが、判断に使うObjective・Variable・Modelの組み合わせを保存／現在読取の境界で検証する。定義の草案保存はFoundation storeの責務として残し、判断snapshotが参照を解決済みとして扱う条件をこのSpecで固定する。

## 契約

1. Objective参照の解決は、`CompanyOsObjectives.checkObjectiveReadiness`と同じ共通readiness関数を通る。Objective自身の`judgment`利用、criteriaのVariableのexact revision/type、現在ACL、`judgment`利用、criterionの型整合を確認する。
2. Model参照の解決は、`inputVariableRefs`と`outputVariableRefs`を重複なくexact revisionで読む。各Variableの型、digest、現在ACL、`judgment`利用、Model参照のscope／期間への包含を確認する。
3. `save`と現在`read`は、定義の用途・scope・period、Objectiveの評価期間を再利用できる検証契約で確認する。失敗は`missing`、`not_applicable`、`unresolved`のいずれかで返し、snapshot保存を中断する。
4. `historical_read`は要求版のdigestとstoreが強制する現在ACLを確認し、依存Variableも同じexact revisionでreadする。記録時点のauthorized useやapplicabilityを再評価しない。
5. Observation referenceに測定descriptorがある場合、Objective評価期間とVariableのunit／aggregation／granularity／scope／periodを`validateEvaluationCompatibility`と同じ条件で検証する。descriptorがない既存snapshotは`historical_read`に限り読み取れる。新規save／current readではdescriptorまたはcanonical measurement metadataが不足していれば未解決として扱う。
6. `philosophy`はsnapshotの任意参照種別であり、必須種別ではない。標準Foundation storeは哲学の正本を推測せず、専用resolverが解決する。

## 変更境界

- 変更対象は`company-os-objectives.ts`、`judgment-problem-snapshot.ts`と影響テスト。
- Objective／Modelの定義型、World Modelの保存契約、哲学resolverの正本契約は変更しない。
- providerの任意validatorは標準検証の代替にならず、標準検証後に追加制約を返せるだけとする。
