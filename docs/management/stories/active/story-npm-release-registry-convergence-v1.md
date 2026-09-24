---
story_id: story-npm-release-registry-convergence-v1
title: npm公開後の遅延registry反映を安全に収束させる
status: active
category: maintenance
period: 2026Q3
spec: docs/specs/story-npm-release-registry-convergence-v1.md
canonical_story_path: docs/management/stories/active/story-npm-release-registry-convergence-v1.md
created_at: 2026-09-24
updated_at: 2026-09-24
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "npm publish成功後のmetadata伝播遅延に対するbounded retry、immutable metadata検証、再実行時のno-republishを同じrelease境界で固定する。"
---

# npm公開後の遅延registry反映を安全に収束させる

## 利用者成果

npm公開を担当するmaintainerとして、publish直後にregistry metadataの反映が遅れても、同じtarballを再公開せずに検証完了まで待ちたい。これにより、公開成功後の一時的なregistry未収束でActionsが不要に失敗することを減らし、再実行時もnpmのimmutable versionを安全に扱える。

## 受け入れ基準

- [ ] publish後のmetadata lookupは、従来の約31秒で打ち切らず、最大8回のbounded retryで遅延反映を待つ。
- [ ] retryの待機は指数バックオフを使い、各待機を30秒で上限化する。metadataが収束するまでdist-tag変更とstaging tag cleanupを開始しない。
- [ ] `version`、`gitHead`、`dist.integrity`のimmutable検証は維持し、不一致を遅延反映として成功扱いしない。
- [ ] 既に一致するmetadataがある再実行では、`npm publish`を呼ばない。
- [ ] 6回を超える遅延lookup後にmetadataが一致するケースと、収束しないケースをテストで固定する。

## 境界

- npm version、公開処理、GitHub Actions workflow、npm credential、dist-tagの意味は変更しない。
- retry上限を超えてmetadataが収束しない場合は失敗し、publishの再試行は行わない。
- 公開後のregistryの実際の伝播時間は外部要因であり、テストではmetadata応答を遅延させて収束契約だけを検証する。

## 完了証拠

同一HEADに対するnpm release unit test、`git diff --check`、およびPR CIで、遅延metadataの収束、immutable digest検証、既存versionのno-republishを確認する。
