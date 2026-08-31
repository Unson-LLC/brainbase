---
story_id: story-j0-durable-run-artifact-contract
title: J0 content-addressed run artifactの保存と検証付き再読込
status: done
category: architecture
spec: docs/specs/j0-durable-run-artifact-contract.md
architecture: docs/architecture/story-j0-durable-run-artifact-contract.md
canonical_story_path: docs/management/stories/active/story-j0-durable-run-artifact-contract.md
created_at: 2026-08-31
updated_at: 2026-08-31
---

# J0 content-addressed run artifactの保存と検証付き再読込

## 利用者成果

Brainbase OSSの利用者として、`executeJudgmentDAG`が返した完全な`JudgmentDAGRunRecord`をローカルへ保存し、プロセスを終了した後でもartifact IDから同じ記録を改ざん検知付きで読み戻したい。これによりJ0 Exit Gateのrun input/output/artifact/versionを永続化し、後続R1が再実行や評価を追加できる安定した入口を持てる。

## 受け入れ基準

- [x] AC-001: `./judgment-dag`からartifact version、artifact ID、save/reload request・receipt、machine-readable error、save/reload関数を公開し、package root・MCP・CLIを自動起動しない。
- [x] AC-002: saveは完全な`JudgmentDAGRunRecord`とartifact schema versionのcanonical JSON bytesをSHA-256でcontent address化し、`sha256:<64 lowercase hex>`を返す。同じ内容の再保存は同じIDとbytesへ収束する。
- [x] AC-003: reloadはartifact ID形式、保存envelope、schema version、canonical bytes、SHA-256、run recordのDAG/execution order/runner version/node input-output整合をすべて再検証し、一つでも不一致なら成功値を返さない。
- [x] AC-004: save/reloadはcaller-owned local rootだけを使い、absolute/traversal locatorを受け取らない。返却recordはstorage bufferから分離したdeep-frozen snapshotである。
- [x] AC-005: focused unitでroundtrip、idempotency、tamper、truncation、wrong ID/version、malformed record、mutation isolationを証明し、fresh process consumer E2Eでpackage tarballからsave→process終了→reloadを証明する。
- [x] AC-006: ADR-022に従い、組織版consumerはOSS packageのexact/pinned versionを依存し、同じ公開APIをsemantic forkなしで利用するsmoke evidenceを別consumer changeで確定する。未取得・partial・別実装の類似動作は成功扱いしない。

## 境界

- J0が所有するのは、単一artifactのcontent-addressed save、検証付きreload、fresh-process readbackまでである。
- R1にはrun_id binding、list/index、同時writer調停、詳細なfault injection/crash recovery、historical replay、outcome/evaluation、version比較、calibrationを残す。
- hosted storage、Graph、database、MCP/CLI command、権限、secret、customer data、公開、deploy、本番変更を行わない。
- 組織版consumer証拠はADR-022の依存方向を守る後続changeであり、このOSS worktreeから組織版sourceをコピーしない。

## 完了条件

AC-001〜AC-005は公開版PR #490と#491、公開版`upstream/develop`の`93e7b946a0b93bd61b61bd1f151e863fca4ac819`でfocused 3 files/35 tests、full 48 files/471 tests、E2E 2/2、typecheck、build、fresh package consumer E2Eをpassした。AC-006は組織版PR #1335で公開版`9c0343c6b967cd34e1a45ed2d7c25d1c3f8ff3ae`をexact pinし、process Aのsave後に独立process Bがrunnerを起動せず同じ公開APIから検証付きreloadする2/2 smokeをpassした。組織版実装HEADは`b7c953fa0081a1e02c0aa465aabf54054a3d96a2`、merge SHAは`4dbdff9b2825edb5ff3d1fded1b7603fc27c86ee`であり、公開sourceの複製やsemantic forkはない。
