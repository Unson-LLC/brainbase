---
story_id: story-brainbase-oss-npm-release-oidc-endpoint
title: GitHub Actions OIDC endpoint拒否理由を安全に確定する
status: active
period: 2026Q3
horizon: quarter
view: business
category: product
spec: docs/specs/story-brainbase-oss-npm-release-oidc-endpoint.md
architecture: docs/architecture/story-brainbase-oss-npm-release-oidc-endpoint.md
business_metric: regional GitHub-hosted runnerでのpublication context検証成功率
related_tasks:
  - task_source: VibePro
    task_ids:
      - story-brainbase-oss-npm-release-oidc-endpoint-source-alignment-review
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The diagnostic implementation is already on develop; this atomic activation PR sets one fixed workflow flag and updates its E2E contract so one fail-closed production run can identify the rejecting predicate."
pr_scope_review_facets:
  - activation-contract
  - release-operations
  - e2e-gate
  - rollback-observability
pr_scope_dependency_boundaries:
  - activation-contract->e2e-gate
  - activation-contract->release-operations
  - release-operations->rollback-observability
created_at: 2026-08-04
updated_at: 2026-08-04
---

# GitHub Actions OIDC endpoint拒否理由を安全に確定する

## 背景

regional hostname対応をmergeした後の再実行run `30884874181`も、`GitHub Actions OIDC endpoint is not trusted`で停止した。ログにはendpoint実値も失敗predicateも残っておらず、明示的`:443`拒否が原因という仮説はまだ確定していない。workflow、repository、run、refのOIDC claim検証へ進む前に停止し、npm registry mutationは発生しなかった。

## Current reality

失敗run `30884874181`ではimmutable commitのvalidationまで成功し、publish jobがtoken取得前のendpoint authority判定で停止した。現行実装はregional hostnameを許可する一方、raw authority内のcolonを一律拒否するため明示的`:443`も拒否するが、実runの入力は未確認である。診断機構はすでに`develop`へmerge済みであり、このPRは認可条件を変更せず、workflow内の固定フラグだけを有効化する。merge後の最初のpublish runは固定booleanを記録して意図的にfail closedし、npm公開とGitHub Release作成には進まない。

## 誰が・何を・なぜ

OSS maintainerは、OIDC URL、path、query、token、userinfo値をログへ出さず、GitHub Actions提供endpointが現行のどのpredicateで拒否されたかを一回の診断runで確定したい。

## Business contextと成功指標

初回OSS公開を止めているproduction release blockerを、推測でtrust boundaryを変更せずに特定する。PR内の成功指標は診断出力が固定booleanだけであること、OIDC requestが呼ばれないこと、通常モードの既存accept/reject testが不変であること。merge後の成功指標は診断runから拒否predicateを一意に判定できることとする。

## 受け入れ基準

- [ ] 診断出力を`url_present`、`parse_ok`、`protocol_https`、`hostname_trusted`、`raw_authority_colon`、`userinfo_present`、`normalized_nondefault_port`の固定booleanへ限定する。
- [ ] URL全文、path、query、OIDC request token、username、passwordの値を出力しない。
- [ ] 診断モードはOIDC requestより前に専用errorで必ず停止し、npm registry mutationへ進まない。
- [ ] 通常モードのendpointおよびclaim認可条件を変更しない。
- [ ] diagnostic flagはdispatch入力として公開せず、このactivation PRでworkflow内の固定値としてのみ有効化する。
- [ ] focused unit、workflow、release validation、E2E、buildを現在HEADで成功させる。
- [ ] 初回公開前の責任契約は対象versionのregistry不存在を要求し、公開後はdist integrityとimmutable gitHead一致を要求する。

## 境界

- npm token、npm organization、GitHub repository設定は変更しない。
- 通常モードの認可条件、artifact contract、registry mutation順序は変更しない。責任契約のregistry証跡だけを公開段階別に明確化する。
- このPRではworkflowの固定診断フラグと対応E2E契約だけを変更する。診断run後の原因修正PRでフラグを必ず削除し、通常publicationを再開する。

## Failure modes

- 診断メッセージへURL、path、query、tokenまたはuserinfo値を含めること。
- 診断モードがOIDC requestやregistry mutationへ進むこと。
- 診断classifierと現行predicateの式がずれ、原因を誤判定すること。
- 診断追加に伴い通常モードのendpointまたはclaim検証を緩めること。

これらはfocused unit testのpositive/negative path、release validation、OSS E2E、buildで現在HEADに結び付ける。

## Release note / operator action

Release note: npm公開を止めているGitHub Actions OIDC endpoint判定について、秘密値を含まない固定boolean診断を追加する。利用者向けCLIやpackage API、通常の認可条件の変更はない。

このactivation PRのmerge後、release ownerは`develop`を`release_ref`に指定して`npm-publish.yml`を一度だけ手動dispatchする。期待結果はpublish jobの専用診断errorによる失敗であり、固定boolean vectorとrun URLをrelease evidenceとして保存する。この間はmerge triggerを含む全publish attemptが同じ固定フラグで停止し、npm公開とGitHub Release作成は行われない。`raw_authority_colon=true`かつ`normalized_nondefault_port=false`で他条件が正常なら、明示的default portを許可する最小修正へ進む。それ以外は失敗predicateに対応する入力契約を再調査する。原因修正PRのownerは同じPRで固定フラグを削除し、通常モードの検証後にpublicationを再実行する。

Rollback instruction: 診断出力や停止境界に問題があればこのactivation commitをrevertし、workflowを再実行せず公開停止を維持する。診断はregistry mutation前に止まるため、このPR単独ではnpm versionを作成しない。公開後のnpm versionはimmutableなので削除や上書きをせず、修正版を新しいforward versionとして公開する。

## Done evidence

現在HEADに結び付いたunit、integration、E2E、buildと独立レビューでactivationのマージ可否を決める。診断runのboolean vectorとrun URLを保存し、原因修正PRで固定フラグを削除する。原因修正のmerge後、元Story `story-brainbase-oss-npm-release` のAC-9としてnpm metadataとGitHub Releaseを検証する。
