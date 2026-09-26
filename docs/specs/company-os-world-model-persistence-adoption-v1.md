---
spec_id: company-os-world-model-persistence-adoption-v1
story_id: story-company-os-world-model-persistence-adoption-v1
status: implemented
spec_maturity: implementation_ready
owner_repository: brainbase
storage_boundary: graph_foundation_plus_atomic_evidence_sidecar
---

# world-model adoption persistence v1 最小仕様

この仕様は、world-modelのModel adoptionについて、承認証跡と正本定義のdigestを保存・読戻し時に検証する最小契約を定める。候補を検証済みへ昇格させず、既存のGraph SSOT、ACL、atomic sidecar境界を維持する。

## 契約

- `modelDigest`は`digestFoundationDefinition(model)`が返す、Model定義のcanonical JSON bytesをSHA-256で計算したdigest（`sha256:<64桁hex>`）とする。各adoption recordへ保存し、読戻し時に指定revisionのFoundation recordのdigestと完全一致することを要求する。
- `modelDigest`の欠落・形式不正・正本digestとの不一致はfail-closedとする。sidecarの形状不正は`corrupt_record`、保存後の正本との不一致は`readback_mismatch`として扱い、既存recordを上書きしない。
- `adoptionState=approved`は有効な`approvalRef: { id, type: "decision", revision }`を必須とする。`approvalRef`の実在・承認状態・対象Model revisionとのbindingは、`WorldModelApprovalReader.isApproved()`へ委譲する。このreader adapterは既存の`DecisionRevisionReader.exists()`を内部利用してよいが、単なるDecision存在確認をapprovedとして返してはならない。Readerがない、参照が存在しない、対象Modelが違う、承認状態でない、またはReaderがエラーを返す場合は`approval_reference_unresolved`として保存・読戻しを成功させない。
- ReaderはDecisionの正本、承認状態、現在の権限を解決する境界であり、world-modelはDecision本文や承認の意味を複製・推測しない。`proposed`は`approvalRef`なしで保存できる。
- Modelとcandidateのcurrent ACLは既存storeのread/write境界で毎回確認する。candidateの`unverified`/`hypothesis`状態を保持し、adoptionやapprovalだけで`verified`へ昇格させない。
- 保存時はlock外の読込後、`mutatePersonalOsWithSidecar`のlock内で同じModel revision、digest、最新ACLを再解決する。digestの変化や参照不在は`revision_conflict`または`not_found`で中断する。

## 永続化形状

`evidence/world-model.json`のadoption recordは、既存項目に加えて次を必須とする。

```yaml
modelRef: { id: string, type: model, revision: positive-integer }
modelDigest: sha256:<64桁hex>
adoptionState: proposed | approved
approvalRef: { id: string, type: decision, revision: positive-integer } # approvedでは必須
```

旧形状で`modelDigest`がないrecordや、approvedなのに`approvalRef`がないrecordは読み戻さず、`corrupt_record`として扱う。承認・参照・digestの検証はatomic sidecar mutationの確定前に行い、検証に失敗した場合はrecordを追加しない。確定後のI/Oやreadbackの失敗は保存前の検証失敗とは区別する。保存直後のreadbackでは承認判定を再実行せず、通常の読取では毎回現在の承認状態と権限を検証する。

## 検証シナリオ

1. proposed adoptionはapprovalRefなしで保存・読戻しでき、Model digestが同じ値で復元される。
2. approved adoptionはapprovalRefなし、Readerなし、参照先不在、Readerエラーのいずれでも保存できない。
3. approved adoptionの読戻しでapprovalRefが実在しなくなった場合、成功扱いにせず`approval_reference_unresolved`を返す。
4. sidecarのmodelDigest欠落・形式不正、または正本digestとの不一致はfail-closedとなる。
5. candidateの未検証状態、Modelの未検証状態、current ACLを保持し、候補やModelをverifiedへ昇格しない。
