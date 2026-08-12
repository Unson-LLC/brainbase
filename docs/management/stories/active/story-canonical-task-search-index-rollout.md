# Story: Postgres正本への検索索引オンライン適用

## 背景

Canonical Taskは既にPostgres正本へ切替済みであり、旧NocoDBとの完全一致は保証しない。
検索索引追加に初回データ移行workflowを使うと、正当なPostgres専用行を競合として扱い、索引適用前に停止する。

## 受け入れ条件

- [x] AC1: 明示承認なしでは検索索引を適用しない。
- [x] AC2: Task本文や旧NocoDBを読み書きせず、基礎schema検査、並行索引追加、valid/ready最終検査だけを行う。
- [x] AC3: 初回データ移行とPostgres切替後の索引追加をrunbookで区別する。
