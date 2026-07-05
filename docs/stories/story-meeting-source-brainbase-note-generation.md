---
story_id: story-meeting-source-brainbase-note-generation
title: Meeting Source MCP transcriptからBrainbase議事録を生成する
status: active
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Meeting Source MCP transcriptからBrainbase議事録を生成する

## Story

Tactiq/Plaud MCPから取得した会議ソースは、Meeting Packの一次資料であって、Tactiq/Plaud側で生成された議事録をBrainbaseの議事録本文として採用してはいけない。Brainbase側はprovider transcriptを正本入力として受け取り、Meeting Packの`transcript_to_meeting_note` loopで議事録ドラフトを作る責任を持つ。

現在の同期workerは、normalized artifactの`text_preview`を`meeting_note_summary.body`に入れてReview Packageへ渡しているため、本文がprovider preview由来になり、Brainbaseが生成した議事録かどうかを契約上判別できない。さらに、Review Packageへ全文transcriptが渡らないため、後段がBrainbase生成を行うための一次資料も不足する。

このstoryでは、Meeting Source MCP sync workerがprovider transcript全文をBrainbase Meeting Pack用のsource materialとして渡し、provider生成note/summaryは非正本metadataとして扱う契約に変更する。Review PackageはBrainbase生成元、source transcript、source hash、provider note非採用フラグを持ち、UIや承認者が「これはBrainbaseが生成対象にしている議事録か」を確認できる状態にする。

## Invariants

- INV-brainbase-note-001: `meeting_note_summary.body`にTactiq/Plaud側の生成済み議事録、AI summary、markdown noteをそのまま採用してはいけない。
- INV-brainbase-note-002: primary source transcript全文はReview Package内のBrainbase source materialとして渡す。
- INV-brainbase-note-003: supporting source transcriptも、重複確認・補助証跡としてReview Packageに渡す。
- INV-brainbase-note-004: provider生成note/summaryは`provider_note_authoritative: false`として扱い、正本本文とは分離する。
- INV-brainbase-note-005: `source_event.content_sha256`と`meeting_note_summary.source_text_hash`は同じ一次transcript hashを指す。
- INV-brainbase-note-006: transcriptが空のartifactは議事録生成の一次資料にしてはいけない。
- INV-brainbase-note-007: Graph SSOT / People SSOT / project playbookの解決順序は既存Review Package ingest側の責務を維持し、source sync workerはprovider transcriptとprovenanceを渡す境界に留める。
- INV-brainbase-note-008: resync preview APIは全文transcriptを返さず、confirm時のReview Package生成に必要な内部stateとしてのみ保持する。
- INV-brainbase-note-009: transcriptがないartifactをMeeting Pack候補から除外した場合、preview APIは`meeting_pack_exclusions`で除外理由を返す。

## DAG

```mermaid
flowchart TD
  poll["poll Tactiq/Plaud MCP"] --> normalize["normalize source artifact"]
  normalize --> transcript["retain full transcript text"]
  normalize --> providerNote["mark provider note non-authoritative"]
  transcript --> transcriptGate["require authoritative transcript"]
  providerNote --> metadataOnly["provider note metadata only"]
  transcriptGate --> dedupe["dedupe source cluster"]
  dedupe --> sourceEvent["build source_event"]
  sourceEvent --> brainbaseInput["build Brainbase source materials"]
  brainbaseInput --> reviewPackage["Review Package meeting_note_summary"]
  reviewPackage --> ingest["meeting-pack review-ingest"]
  ingest --> graph["Graph SSOT / People SSOT playbook"]
  graph --> noteLoop["transcript_to_meeting_note loop"]
```

## Acceptance Criteria

- [ ] normalized source artifactは`source_text`、`source_text_length`、`transcript_hash`を保持する。
- [ ] raw artifactに`transcript_text`とprovider生成`note_text`/`markdown`が両方ある場合、Brainbase source materialは`transcript_text`を一次資料にする。
- [ ] generated Review Packageの`meeting_note_summary`は`generator: brainbase_meeting_pack`、`generation_source: transcript_to_meeting_note`、`provider_note_authoritative: false`を含む。
- [ ] generated Review Packageの`meeting_note_summary.source_transcripts`はprimary/supporting sourceのprovider、resource URI、hash、全文textを保持する。
- [ ] `meeting_note_summary.body`はprovider生成note/summary文字列を含まない。
- [ ] `source_artifact_refs`は本文ではなく、hashとresource URIの参照情報に限定する。
- [ ] existing Tactiq/Plaud dedupe、cursor advance、scope guardの挙動は変えない。
- [ ] provider noteのみでtranscriptがないartifactは取得件数には残るが、Meeting Pack候補数は増やさず、Review Package ingestへ送らない。
- [ ] resync preview APIのclusterには`source_text`全文を含めない。
- [ ] provider noteのみのartifactはpreviewで`provider_note_available_without_transcript`として除外理由を確認できる。

## Scenario IDs

- S-001: transcript-backed Tactiq/Plaud artifacts are normalized into Brainbase source materials and deduped into one Meeting Pack candidate.
- S-002: provider-generated notes, markdown, and summaries are isolated as non-authoritative metadata and never promoted to Brainbase minutes.
- S-003: transcriptless provider note artifacts remain visible in preview exclusions but are not submitted to Review Package ingest.

## Verification

- Unit: `tests/server/meeting-source-mcp-sync-worker.test.js`
- E2E contract: `tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts`
- VibePro: `vibepro story diagnose . --id story-meeting-source-brainbase-note-generation --run-graphify`
- PR gate: `vibepro pr prepare . --base origin/develop --story-id story-meeting-source-brainbase-note-generation`
