---
story_id: story-judgment-foundation-coherence-v1
title: 判断に使う目的と世界モデルの参照整合を共通経路で確認する
status: implemented
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-objectives-v1", "story-company-os-world-model-v1", "story-company-os-problem-snapshot-v1"]
---

# 判断に使う目的と世界モデルの参照整合を共通経路で確認する

## 利用者成果

判断者として、目的・測定変数・世界モデルを組み合わせるときに、存在する版・現在の権限・用途・適用範囲が揃っていることを確認してから判断を始めたい。

## 受け入れ条件

- [x] AC-01: 標準Foundation reference providerは、Objectiveのreadiness共通関数を経由して、Objectiveの基準Variableの存在・正確な版・型・現在ACL・`judgment`用途・基準との型整合を検証する。
- [x] AC-02: 標準Foundation reference providerは、Modelの全input/output Variableについて、存在・正確な版・型・現在ACL・`judgment`用途・参照範囲と期間を検証する。不足や不整合は判断保存・現在読取を解決済みにしない。
- [x] AC-03: Foundationの草案保存は許可するが、判断snapshotのsave/readでは未登録・用途外・適用外・digest不一致をfail closedにする。
- [x] AC-04: historical readは、要求版のdigestと依存Foundationの現在read ACLを再確認する。記録時点の用途・適用範囲は再判定せず、現在のlatestへ置換しない。
- [x] AC-05: Objectiveの評価期間、Variableの測定単位・集計・粒度・scope・periodを、既存の評価互換性契約と同じ条件で確認できる。descriptorがない既存Observationは`historical_read`に限り読めるが、新規save／current readではcanonical measurement metadataとdescriptorが揃わない限り解決済みにしない。
- [x] AC-06: `philosophy`は任意のsnapshot参照種別として受け付けるが、必須参照にはせず、正本解決は専用resolverへ委譲する。

## 完了証拠

- `src/company-os-objectives.ts`にObjective readinessの共通関数を抽出し、標準Foundation providerから同じ経路を呼び出している。
- `src/judgment-problem-snapshot.ts`でObjective／Model依存のexact revision・型・digest・現在ACL・用途・適用範囲を検証し、read-only `validateJudgmentProblemSnapshot`をsave/readと同じ参照解決経路へ接続している。
- `tests/judgment-problem-snapshot.test.ts`でObjective／Model依存不足、current ACL、historical read、測定descriptorとcanonical metadataの不整合、descriptorなし既存Observationのhistorical read、任意philosophy参照を確認している。
- 検証結果: `npx vitest run tests/judgment-problem-snapshot.test.ts --testTimeout=30000`（14 passed）、`npx vitest run tests/foundation-public-provider.test.ts --testTimeout=30000`（7 passed）、`npx vitest run tests/ontology-foundation.test.ts --testTimeout=30000`（8 passed）、`npx vitest run tests/foundation-store.test.ts --testTimeout=30000`（17 passed）、`npx tsc -p tsconfig.json --noEmit`（success）。
