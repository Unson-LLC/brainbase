---
story_id: story-local-web-private-extension-v1
title: 公開Personal画面へ私有版の画面とAPIを安全に接続する
status: active
created_at: 2026-09-30
owner_repository: brainbase
depends_on: ["story-local-web-host-objectives-v1"]
---

# 公開Personal画面へ私有版の画面とAPIを安全に接続する

## 利用者成果

公開版の「今日」「目的と現状」などと同じローカルWeb画面に、医療版の私有画面を追加できる。共通画面のコピーを医療版に持たない。

## 開発判断

SIMPLIFICATION。直近の公開画面は複数のPRで広がったが、医療版で使えたという外部成果は未確認。今回はホストの接続契約と一つの合成画面の接続に絞る。

## 受入条件

- [x] AC-01: ホストに明示登録した拡張だけが、`/api/extensions/<id>` と `/ui/extensions/<id>` に接続でき、標準画面を残したまま同じシェルに画面を追加する。
- [x] AC-02: ID・配信ファイル・画面エントリーの不正値、重複、パス逸脱、標準経路への横取りを起動時または要求時に拒否する。
- [x] AC-03: 拡張への要求も既存のloopback Host検査、GET以外の同一Origin・起動トークン検査、CSP、静的ファイルの許可リストを通る。
- [x] AC-04: 拡張なしの`brainbase web:serve`と既存画面/APIは従来どおり動く。合成拡張でAPI・画面資産・ナビの接続をテストする。

## 最小Spec

`LocalWebHostOptions.extensions` は拡張ID、API module factory、私有資産ディレクトリ、許可ファイル、画面エントリーを受ける。API handlerは自分のprefixにだけ呼ばれる。画面は公開シェルの`screens`へ追加し、私有コードは公開packageへ含めない。医療版の接続実装は`brainbase-medical-project`で行う。
