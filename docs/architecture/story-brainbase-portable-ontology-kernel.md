# Portable Ontology Kernel Architecture

## Decision

Brainbase OSSに、公開・ローカル完結のPortable Ontology Kernelを追加する。Ontologyは利用者のcanonical factを保持する場所ではなく、`~/.brainbase/personal-os/`へ保存されるfactを同じ意味で検証・監査・解釈するためのversion付き契約である。

標準Ontologyはnpm packageに同梱するimmutableなreleaseとする。個人や組織の値、Unson内部のDecision/RACI、production receipt、署名鍵は含めない。利用者のcanonical factは引き続きPersonal OSが正本であり、Ontologyの導入時に自動変更しない。

## Layers

1. **Bundled release**: 型、関係語彙、制約、推論、変更・衝突の5領域とrelease metadataを保持する。
2. **Pure kernel**: release取得、Personal OS snapshotの意味監査、意思決定の導出、version impactの説明を副作用なしで行う。
3. **Local SSOT adapter**: `loadPersonalOs`の成功・失敗を監査状態へ変換し、読取不能を違反0件として返さない。
4. **MCP/CLI projection**: agentと利用者に同じmachine-readable resultを返す。既存のcontext/list/search surfaceは変更しない。
5. **Guarded promotion**: onboardingが作った書込予定snapshotを最初のcanonical writeより前に検証し、error severityの違反をrule ID付きで拒否する。

依存方向は `MCP/CLI -> local adapter -> pure kernel -> bundled release` とし、pure kernelからfilesystem、MCP、hosted serviceへ依存しない。

## Canonical Boundaries

- Standard Ontology release: package sourceに同梱された公開契約。
- User facts: `graph.json`、`personal-kg.jsonl`、`relationships.json`、`decisions.jsonl`。
- Raw sources/candidates: 利用者が明示承認してpromotionするまでcanonical factではない。
- Inference result: 派生結果でありcanonical factを上書きしない。Ontology version、根拠ID、判定時点、説明を必ず伴う。

## Validation and Failure Semantics

- schema parse failure、file missing、filesystem read failureは`unverified`であり、`complete`かつviolations 0とは別状態にする。
- 意味違反は安定したrule ID、severity、対象、説明を返す。
- pre-write guardはerrorのみをblockし、warningは監査結果として残す。
- auditはread-onlyであり、修復・削除・自動migrationを行わない。

## Decision Inference

意思決定の置き換えは新Decisionの明示的な`supersedes`参照だけで成立する。同じ`topic`に複数の未置換Decisionがある場合はconflictとし、更新日時の新しさだけで優先しない。循環参照、自己参照、存在しない参照は検証違反である。

既存Decisionは追加fieldを持たなくても読み続けられる。`topic`がないlegacy recordは独立したtopicとして扱い、導入によって突然競合扱いしない。

## Version and Evolution

release metadataはsemantic version、effective date、compatibility、migration、rollbackを持つ。v1ではpackage同梱releaseをactiveとし、未知versionを暗黙に解釈しない。impact APIは既知versionからactive versionまでの変更と必要な利用者操作を説明する。

## Safety and Compatibility

- hosted backend、network、Infisical、bb.unson.jpを必要としない。
- 既存canonical file formatはoptional field追加だけに留める。
- 既存MCP toolとonboardingの成功経路を維持する。
- full OWL/RDF/SHACL engineや任意rule実行は導入しない。
- 将来のlocal extensionは別Storyとし、v1で標準releaseを上書き可能にしない。
