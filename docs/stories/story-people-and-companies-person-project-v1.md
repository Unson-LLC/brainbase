---
story_id: story-people-and-companies-person-project-v1
title: 人を加えるときに、関わるプロジェクトを選べるようにする
status: in_progress
created_at: 2026-10-13
implementation_started: true
owner_repository: brainbase
---

# 人を加えるときに、関わるプロジェクトを選べるようにする

## 利用者成果

組織版で人を加える人として、その人が関わるプロジェクトを選んで記録したい。自分の会社のプロジェクトへ一律に置かれると、関わっていないプロジェクトの関係者として数えられてしまう。

## 背景

- 組織版は人の記録をプロジェクトに置き、その置き場を関係者として扱う。S3-2 では新しい人を自社のプロジェクトに作っていた。
- 2026-10-13 の佐藤さんの裁定(c)で、「人を加える」は参加プロジェクトを1つ選ばせ、そこに作ることにした。
- 選べるプロジェクトは組織の権限で決まるので、部品ではなくホストが読み取り結果で渡す。OSSの手元のホストは人をプロジェクトに置かないので、渡さない。

## 受入条件

- [ ] AC-01: 読み取り結果に `personProjects`（`[{ code, name }]`）があるとき、「人を加える」に「関わるプロジェクト」の選択欄を出し、選ばないと送らない。選んだものを `entity.projectCode` で送る。
- [ ] AC-02: `personProjects` が無いとき（手元のホスト）は、選択欄を出さず、`projectCode` も送らない。
- [ ] AC-03: 「会社を加える」には選択欄を出さない。
- [ ] AC-04: `personProjects` の形が正しくなければ、読み取りを失敗として扱う。

## 検証

- `tests/ui/people-and-companies-view.test.mjs`
