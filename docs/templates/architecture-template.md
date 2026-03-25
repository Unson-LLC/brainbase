---
adr_id: ADR-xxx
title: タイトル
source_story:
  story_id: STR-xxx
  story_path: docs/stories/STR-xxx-概要.md
status: proposed | accepted | superseded
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
---

# ADR-xxx: タイトル

## ステータス

Proposed / Accepted / Superseded

## コンテキスト

この ADR が必要になった背景。Story からの要求を技術的視点で整理。

## 判定

### 既存アーキテクチャで対応可能か

- [ ] はい → 既存パターンで実装可能。新規 ADR 不要。
- [ ] いいえ → 以下に新規アーキテクチャ判断を記述。

## 判断

### レイヤー / 境界

- どのレイヤーに変更が入るか
- モジュール間の境界はどこか

### データ層

- SSOT の所在（正本はどこか）
- データの流れ

### 制約

- この判断で受け入れるトレードオフ

## 代替案

検討した他のアプローチと却下理由。

## 影響

- 既存コードへの影響範囲
- 移行が必要な場合の方針

---

**ガードレール**: このファイルには具体的な API / DB スキーマ / 実装コードを書かない。レイヤー / 境界 / データ層 / SSOT の所在のみ。
