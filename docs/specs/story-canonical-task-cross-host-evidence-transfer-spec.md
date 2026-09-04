---
spec_id: SPEC-canonical-task-cross-host-evidence-transfer
story_id: story-canonical-task-cross-host-evidence-transfer
status: active
date: 2026-09-05
implementation_files:
  - scripts/capture-canonical-task-cutover-evidence.js
test_files:
  - tests/server/scripts/capture-canonical-task-cutover-evidence.test.js
---

# Cross-host Mac evidence transfer spec

`--mac-source-root`はoptionalである。指定時、captureは元Mac resultのbytesを更新せず、`mac_checkout`を
provenanceとして保持する。snapshotのGit HEADは`head_sha`と完全一致し、raw logは元`mac_checkout`から導く
同一relative pathにあるregular fileで、`raw_log_hash`と一致しなければならない。

元absolute raw logのcheckout外、relative path escape、snapshot root/raw logのsymlink、Git HEAD/hash不一致は
fail closedとする。snapshotのGit clean性は検証対象にせず、cleanであると記録しない。指定なしでは既存の
same-host checkout/raw log検証を維持する。
