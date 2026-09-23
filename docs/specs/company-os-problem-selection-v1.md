---
spec_id: company-os-problem-selection-v1
story_id: story-company-os-problem-selection-v1
status: implemented
---

# Problem selection v1

## 目的と境界

Problem selection は、evidence-sidecar にある `ProblemCandidate` を、固定した
Objective・Constraint・条件付き選好・委譲外判断・切替／機会／探索費用と探索上限に
照らして比較する、選択用の meta `JudgmentProblem` である。

選択用 meta Problem と、選ばれた候補を実際に解く将来の Problem は同一視しない。
候補の比較前に全候補の完全な Problem snapshot を作る必要はない。比較で採択された
候補には `problemCreationRequest` を残し、その Problem が独自の完全な snapshot と
現在の認可を満たしてから実行へ進む。

この契約は選択結果を保存するが、資源確約、権限発行、Objective の変更、外部作用を
行わない。資源予約や実行は既存の resource／execution boundary とその provider が
担当する。

## API

公開入口は `src/problem-selection.ts` の次の契約である。

- `createProblemSelection(request)`（`runProblemSelection`／`selectProblem` は別名）
- `evaluateProblemSelectionWithComposition(input)`
- `computeProblemSelectionRecordId(record)`
- `createProblemSelectionRecordStore({ root, accessProvider? })`
- `saveProblemSelectionRecord`／`loadProblemSelectionRecord`

`createProblemSelection` は次の値を開始時に固定する。

1. 選択 meta Problem の exact `JudgmentProblemSnapshotReference`
2. versioned `JudgmentDAGCompositionDefinition`
3. 候補 ID、`payloadDigest`、owner scope
4. Objective／Constraint の exact revision と digest
5. 条件付き選好、委譲する判断、各費用、探索上限、評価時点

候補は `ProblemCandidateStore.readCandidate` で現在の認可を確認してから、状態が
`candidate` であること、payload digest と owner scope が開始時の参照と一致することを
検証する。検証できない候補、ACL 外、版・digest 不一致、merge／dismissed 済み候補は
比較へ渡さず、理由を持つ `human_review_required` とする。候補本文は SelectionRecord
へコピーしない。

比較方法は `ProblemSelectionEvaluationPort` であり、共通の選択 DAG composition を
実行する adapter 境界である。`evaluateProblemSelectionWithComposition` は既存の
`executeJudgmentDAGComposition` を使い、指定した child の conclusion を選択結果として
検証する。OSS は単一万能スコアや経営用推論を実装しない。

## 不変条件

- 状態は `selected` または `human_review_required`。目的が衝突し比較不能な場合は
  後者で、衝突した Objective と理由を保持する。
- 行動は `start`、`continue`、`observe`、`hold`、`stop` のいずれか。`hold` は見直し時期を
  必須とする。
- `selected` を返す比較結果は、固定候補集合内の `selectedCandidateId` と行動を必ず持つ。
  どちらかが欠ける不完全な結果は採択せず、`human_review_required` とする。
- `start`／`continue` の採択は候補参照と `completeSnapshotRequired: true` を持つ
  `problemCreationRequest` を返す。これは Problem 作成要求であり、実行許可ではない。
- unknown は `ProblemSelectionUnknown` として理由付きで保持する。未知の費用を `0` に
  置換しない。unknown が残る `start`／`continue`／`hold`／`stop` は人手確認へ戻し、
  `observe` は追加観測という選択を保持できる。
- 比較結果だけで資源権限、実行権限、Objective 更新を発行しない。保存レコードの
  `resourceAuthority`、`executionPermission`、`objectiveChange` は常に `none`。
- SelectionRecord は content-addressed な不変 JSON。保存後の同じ ID は同じ canonical
  bytes でなければならず、読戻し時に digest、版、ACL を再検証する。

## 反例と境界

| 事例 | 結果 |
| --- | --- |
| 候補の current ACL が確認できない | `human_review_required`。候補本文を要約して公開しない |
| 候補の payload digest が変わった | `human_review_required`。古い選択条件で比較しない |
| Objective 同士の優先順位が比較不能 | 衝突する Objective ID と理由を残して人へ返す |
| 探索上限を超えた | 候補を勝手に省略せず、上限超過理由を残して人へ返す |
| 切替費用が未知 | `unknown` を保持し、通常の着手判断を成功扱いにしない |
| 選択結果から予約・権限発行を要求 | SelectionRecord の契約違反。resource／execution provider へ戻す |
| 一部候補だけ完全 Problem がある | その exact ref は任意で後続 Problem に接続できるが、他候補に完全 snapshot を要求しない |

## 検証

- `tests/problem-selection.test.ts` は契約 fixture、unknown／目的衝突／ACL・digest 境界、
  meta Problem と後続 Problem の分離、実 store の round-trip と改ざん検知を確認する。
- Graphify の bounded lookup は Story09 を対象に実行済み。現時点の既存 graph には Story09
  の直接影響ノードがなく、これは「影響なし」の証明ではない。
- 対象 build とテストはローカルで実行し、全体 suite と CI は通常の PR 境界で確認する。
