---
story_id: story-company-os-subdag-v1
title: 下位判断の根拠と不確実性まで辿って親判断に使える
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: []
---

# 下位判断の根拠と不確実性まで辿って親判断に使える

## 利用者成果

判断者として、運用・技術・費用の下位問題を再利用し、必要時に検証へ降りたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 既存 judgment-dag kernel の拡張

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- なし。既存実装との重複は着手時に確認する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: DAG定義版・今回の構成版・runを分離し、親子runと入出力契約を記録する。
- [x] AC-02: 子へ問い・入力・固定条件・委任範囲を渡し、結論・根拠・適用範囲・不確実性・run参照を返す。
- [x] AC-03: 子の必要権限が親の委任範囲を超えれば実行しない。判断ノードから資源確約や外部作用を起こせない。
- [x] AC-04: 循環・型不一致・子の失敗／保留を検出し、親の成功へ丸めない。構成変更は新改訂として再検証する。

## 対象外

全子DAGへの五層強制、任意コードを実行する汎用workflow engine。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

`src/judgment-dag-composition.ts` とStory05のProblemSnapshot adapterを実装し、`npm run build` と `npx vitest run tests/judgment-problem-snapshot.test.ts tests/judgment-dag-composition.test.ts`（2 files、combined 26 tests）で検証済み。検証には、現在ACLを確認するsnapshot参照、historical readerの実行利用拒否、DAG版・入出力契約・委任scope・capabilityの事前検証、artifact readback不一致、循環、子の失敗／保留伝播を含む。任意callbackのsandboxや外部作用の隔離はhost側の責任であり、OSSの保証範囲を越えていない。PR #526（[merge d7ddc89](https://github.com/Unson-LLC/brainbase/commit/d7ddcc899b71829535a930298d8af3242d0c3b61)）、[CI 35839045812](https://github.com/Unson-LLC/brainbase/actions/runs/35839045812) pass、combined 26 testsとreview pass。
