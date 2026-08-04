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
pr_scope_reason: "The hostname predicate and its positive and negative regression tests form one fail-closed trust-boundary correction."
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
created_at: 2026-08-04
updated_at: 2026-08-04
---

# GitHub Actions OIDC endpoint拒否理由を安全に確定する

## 背景

regional hostname対応をmergeした後の再実行run `30884874181`も、`GitHub Actions OIDC endpoint is not trusted`で停止した。ログにはendpoint実値も失敗predicateも残っておらず、明示的`:443`拒否が原因という仮説はまだ確定していない。workflow、repository、run、refのOIDC claim検証へ進む前に停止し、npm registry mutationは発生しなかった。

## Current reality

失敗run `30884874181`ではimmutable commitのvalidationまで成功し、publish jobがtoken取得前のendpoint authority判定で停止した。現行実装はregional hostnameを許可する一方、raw authority内のcolonを一律拒否するため明示的`:443`も拒否するが、実runの入力は未確認である。次のPRは認可条件を変更せず、固定booleanだけを出す診断モードで失敗predicateを確定する。

## 誰が・何を・なぜ

OSS maintainerは、OIDC URL、path、query、token、userinfo値をログへ出さず、GitHub Actions提供endpointが現行のどのpredicateで拒否されたかを一回の診断runで確定したい。

## Business contextと成功指標

初回OSS公開を止めているproduction release blockerを、推測でtrust boundaryを変更せずに特定する。PR内の成功指標は診断出力が固定booleanだけであること、OIDC requestが呼ばれないこと、通常モードの既存accept/reject testが不変であること。merge後の成功指標は診断runから拒否predicateを一意に判定できることとする。

## 受け入れ基準

- [ ] 診断出力を`url_present`、`parse_ok`、`protocol_https`、`hostname_trusted`、`raw_authority_colon`、`userinfo_present`、`normalized_nondefault_port`の固定booleanへ限定する。
- [ ] URL全文、path、query、OIDC request token、username、passwordの値を出力しない。
- [ ] 診断モードはOIDC requestより前に専用errorで必ず停止し、npm registry mutationへ進まない。
- [ ] 通常モードのendpointおよびclaim認可条件を変更しない。
- [ ] diagnostic flagはworkflow内の固定値とし、dispatch入力として公開しない。
- [ ] focused unit、workflow、release validation、E2E、buildを現在HEADで成功させる。
- [ ] 初回公開前の責任契約は対象versionのregistry不存在を要求し、公開後はdist integrityとimmutable gitHead一致を要求する。

## 境界

- npm token、npm organization、GitHub repository設定は変更しない。
- 通常モードの認可条件、artifact contract、registry mutation順序は変更しない。責任契約のregistry証跡だけを公開段階別に明確化する。
- このPRのworkflow変更は診断フラグの固定だけに限定し、診断run後の原因修正PRで必ず解除する。

## Failure modes

- 診断メッセージへURL、path、query、tokenまたはuserinfo値を含めること。
- 診断モードがOIDC requestやregistry mutationへ進むこと。
- 診断classifierと現行predicateの式がずれ、原因を誤判定すること。
- 診断追加に伴い通常モードのendpointまたはclaim検証を緩めること。

これらはfocused unit testのpositive/negative path、release validation、OSS E2E、buildで現在HEADに結び付ける。

## Release note / operator action

Release note: npm公開を止めているGitHub Actions OIDC endpoint判定について、秘密値を含まない固定boolean診断を追加する。利用者向けCLIやpackage API、通常の認可条件の変更はない。

merge後のoperator actionは、`develop`を`release_ref`に指定して`npm-publish.yml`を手動dispatchし、固定boolean vectorを保存すること。`raw_authority_colon=true`かつ`normalized_nondefault_port=false`で他条件が正常なら、明示的default portを許可する最小修正へ進む。それ以外は失敗predicateに対応する入力契約を再調査する。

Rollback instruction: 公開前に問題が見つかった場合はhotfix commitをrevertしてworkflowを再実行しない。公開後のnpm versionはimmutableなので削除や上書きをせず、修正版を新しいforward versionとして公開する。

## Done evidence

現在HEADに結び付いたunit、integration、E2E、buildと独立レビューでマージ可否を決める。merge後は元Story `story-brainbase-oss-npm-release` のAC-9としてnpm metadataとGitHub Releaseを検証する。
