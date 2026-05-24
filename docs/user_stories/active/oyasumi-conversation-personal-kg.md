---
story_id: oyasumi-conversation-personal-kg
title: OyasumiでCodex/Claude Code会話をPersonal KGへ取り込む
reason: Existing /oyasumi command, Personal KG candidate writer, and Mana capture route boundaries are reused; no new runtime boundary, datastore, or external API contract is introduced.
---

# OyasumiでCodex/Claude Code会話をPersonal KGへ取り込む

## 背景

`/oyasumi` のPersonal KG学習は議事録/transcriptだけを見ると、CodexやClaude Codeとの当日会話に現れた判断基準を取り逃がす。議事録由来の抽出が0件でも、agent会話由来の再利用可能な判断がある場合はPersonal KG候補として扱う必要がある。

## 方針

当日JSTのCodex/Claude Codeユーザー入力を日次入力として収集し、議事録由来とは別系列のPersonal KG candidateとしてdry-run/writeできるようにする。OpenRouter/OpenAI-compatible fallbackは使わず、semantic抽出はCodex subagent、Mana captureはBedrock設定を正とする。

## Acceptance Criteria

- `/oyasumi` 手順でCodex/Claude Code会話ログのdry-run/writeコマンドが明示され、meeting由来とconversation由来の件数を分けて報告する。
- conversation extractorは当日JSTのユーザー入力を収集し、tool resultや生成コマンドを除外し、0件時はPersonal KG 0件ではなくログ取得漏れとして非ゼロ終了する。
- conversation由来候補はowner-visibleのPersonal KG candidateとして `personal_kg_core` / `needs_review` に分類され、artifactはprivate権限で保存される。
- OpenRouter/OpenAI-compatible fallback経路は対象コードから除去され、Bedrock-only Mana captureとCodex semantic backendの回帰リスクがテストで確認される。

## Architecture Decision

ADR不要。既存の `/oyasumi` command、Node script、candidate writer、Express routeの範囲に閉じた変更であり、新しい永続化方式、外部API契約、UI runtime境界は追加しない。
