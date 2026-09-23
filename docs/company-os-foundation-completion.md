# Company OS OSS基盤の完了記録

2026-09-23時点の完了記録。対象は `Unson-LLC/brainbase` のOSS共通基盤と、その共通SSOT sidecar補助である。

## 完了した8 Story

8件ともStory本文の受入条件を確認し、実装開始済み（`implementation_started: true`）から、レビュー・CI・mergeまで完了した。Story本文の `status` は `done` とし、`.vibepro/config.json` の `status: active` は登録状態を示す既存値として維持している。

| Story | Story本文 | PR / merge | CI・検証 |
| --- | --- | --- | --- |
| `story-company-os-ontology-v1` | [story-company-os-ontology-v1.md](stories/story-company-os-ontology-v1.md) | [PR #521](https://github.com/Unson-LLC/brainbase/pull/521) / [`793e571`](https://github.com/Unson-LLC/brainbase/commit/793e571352f018b4d89f201283aacae3365abbf7) | [CI 35831944139](https://github.com/Unson-LLC/brainbase/actions/runs/35831944139) pass、独立review・delta review pass |
| `story-company-os-objectives-v1` | [story-company-os-objectives-v1.md](stories/story-company-os-objectives-v1.md) | [PR #522](https://github.com/Unson-LLC/brainbase/pull/522) / [`0cdf0da`](https://github.com/Unson-LLC/brainbase/commit/0cdf0da31ce422f34b48cbfebf08971c8625770d) | [CI 35834690071](https://github.com/Unson-LLC/brainbase/actions/runs/35834690071) pass、focused 17 tests・review pass |
| `story-company-os-sidecar-v1` | [story-company-os-sidecar-v1.md](stories/story-company-os-sidecar-v1.md) | [PR #523](https://github.com/Unson-LLC/brainbase/pull/523) / [`7d7da51`](https://github.com/Unson-LLC/brainbase/commit/7d7da51047629cb85e3b0a2c4fecf7c0a2210cef) | [CI 35836983284](https://github.com/Unson-LLC/brainbase/actions/runs/35836983284) pass、focused 22 tests |
| `story-company-os-problem-snapshot-v1` | [story-company-os-problem-snapshot-v1.md](stories/story-company-os-problem-snapshot-v1.md) | [PR #524](https://github.com/Unson-LLC/brainbase/pull/524) / [`138adf9`](https://github.com/Unson-LLC/brainbase/commit/138adf9f66aa43b40299bb357efc7102d0d85283) | [CI 35837108500](https://github.com/Unson-LLC/brainbase/actions/runs/35837108500) pass、focused 11 tests・Snapshot/SubDAG 26 tests review pass |
| `story-company-os-world-model-v1` | [story-company-os-world-model-v1.md](stories/story-company-os-world-model-v1.md) | [PR #525](https://github.com/Unson-LLC/brainbase/pull/525) / [`fd03778`](https://github.com/Unson-LLC/brainbase/commit/fd03778bb3c86df4ccd11d5d765d3354b90c80a4) | [CI 35837699152](https://github.com/Unson-LLC/brainbase/actions/runs/35837699152) pass、12 tests・review pass |
| `story-company-os-subdag-v1` | [story-company-os-subdag-v1.md](stories/story-company-os-subdag-v1.md) | [PR #526](https://github.com/Unson-LLC/brainbase/pull/526) / [`d7ddc89`](https://github.com/Unson-LLC/brainbase/commit/d7ddcc899b71829535a930298d8af3242d0c3b61) | [CI 35839045812](https://github.com/Unson-LLC/brainbase/actions/runs/35839045812) pass、combined 26 tests・review pass |
| `story-company-os-constraints-v1` | [story-company-os-constraints-v1.md](stories/story-company-os-constraints-v1.md) | [PR #527](https://github.com/Unson-LLC/brainbase/pull/527) / [`faaa517`](https://github.com/Unson-LLC/brainbase/commit/faaa517822c8ed4006a93449ea329962550798d1) | [CI 35838360642](https://github.com/Unson-LLC/brainbase/actions/runs/35838360642) pass、focused 20 tests・review pass |
| `story-company-os-reservations-v1` | [story-company-os-reservations-v1.md](stories/story-company-os-reservations-v1.md) | [PR #528](https://github.com/Unson-LLC/brainbase/pull/528) / [`25e97fb`](https://github.com/Unson-LLC/brainbase/commit/25e97fb1e2778f60d9749f75611fcd0ecff0c78e) | [CI 35837800344](https://github.com/Unson-LLC/brainbase/actions/runs/35837800344) pass、9 tests・review pass |

### 最終CIの境界

先行基盤を含む最後の [CI 35839045812](https://github.com/Unson-LLC/brainbase/actions/runs/35839045812) は、head `c12fd3ab8251164ac30f29a2ce71a839909c27d4` で74 files・777 tests、public contracts 2 files・11 tests、build/docs/smoke passを確認した。deployはskipであり、npm公開・配布・本番組込みの完了を意味しない。

## 未実装の境界

当初計画の未実装Storyは `planned` のまま維持し、組織固有・Mana側のStoryや予定を完了へ変更していない。元のOSS側残件13件も `planned`・`implementation_started: false` を維持する。当初計画全体の残り19件へ、今回追加したレビュー追補5件は算入せず、別のplanned登録として扱う。OSS共通基盤の完了は、npm公開、配布repoへの取り込み、組織runtime／Manaへの本番組込みを含まない。

## 追補Story

レビューで残った候補4件と、共有 `dist` のbuild/pack競合疑いを切り分ける調査1件を、実装なしのplanned Storyとして登録した。

- [story-company-os-world-model-reference-safety-v1.md](stories/story-company-os-world-model-reference-safety-v1.md)
- [story-company-os-world-model-persistence-adoption-v1.md](stories/story-company-os-world-model-persistence-adoption-v1.md)
- [story-company-os-reservation-runtime-input-safety-v1.md](stories/story-company-os-reservation-runtime-input-safety-v1.md)
- [story-company-os-reservation-corrupt-ledger-diagnostics-v1.md](stories/story-company-os-reservation-corrupt-ledger-diagnostics-v1.md)
- [story-company-os-shared-dist-build-pack-isolation-v1.md](stories/story-company-os-shared-dist-build-pack-isolation-v1.md)

共有 `dist` の件は、`tests/npm-consumer-smoke.integration.test.ts:37` のroot build、`tests/npm-release-validation.integration.test.ts:46` から `scripts/npm-release.mjs:245` の `npm pack` prepare、`tests/repo-hygiene.test.ts:43` のdry-run prepareが同じ出力先へ書く疑いを記録したもの。旧CI 35837694006で `foundation-store.js` read EOFが出たが、局所package 8 testsと同時実行1回では再現せず、原因は未確定のまま実装変更を行っていない。
