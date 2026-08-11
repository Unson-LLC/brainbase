---
name: google-drive-structure
description: Google Driveの共有コンテンツ正本を、Graph SSOT・所有repo・個人workspaceから分離し、明示アカウントでread-only確認するガイド。
---

# Google Drive authority guide

## Triggers

- ファイルの正本をDrive・Graph・repo・個人workspaceのどこに置くか判断するとき
- 共有ドライブの現行構成、所有者、参照URL、鮮度を確認するとき
- ローカルのDrive入口やsymlinkの必要性を評価するとき

## Authority boundary

| 情報 | 正本 |
|---|---|
| 人、組織、顧客、project、用語、意思決定、RACI、brand定義 | Graph SSOT |
| version管理するcode、手順、組織横断文書、project文書 | 所有repo |
| 共同編集するoffice文書、binary、契約書、納品物、brand asset | 所有者が管理するDrive |
| 個人の下書き、cache、runtime、ローカル番地 | 個人workspace |

GraphにはDriveの共有URLをpointerとして記録できるが、個人の絶対パスやローカルmount pathを入れない。Drive上のファイル内容とGraph上の組織事実を二重正本にしない。

## Live discovery first

固定されたフォルダ名や過去の構成を前提にせず、対象accountとclientを明示してread-onlyで確認する。

```bash
gog auth list --check
gog --account <account> --client <client> --readonly drive drives --json
gog --account <account> --client <client> --readonly drive ls --parent <drive_id> --json
```

- 認証失敗、timeout、権限不足は `0件` ではなく `未確認` と記録する。
- 共有ドライブが0件でも、My Driveや「共有アイテム」が空だとは推論しない。
- accountを切り替えた成功結果で、失敗したcollectorの結果を代用しない。
- file ID、owner、更新時刻、共有URLを証拠として残し、表示名だけで同一物と判断しない。

## Observed snapshot (2026-08-08)

これは設計規範ではなく、同日read-only APIで確認したsnapshotである。操作前には再取得する。

- `info@unson.jp` / `default`: 共有ドライブ `雲孫ドライブ`。rootには `00_受信箱`、`10_案件`、`20_運用`、`30_資料`、`90_システム`、`99_アーカイブ` と、別IDの `brand-assets` が2件存在する。重複名を理由に統合・削除しない。
- `k.sato@sales-tailor.jp` / `salestailor-e2e`: 共有ドライブ `SalesTailor`。rootには `BO`、`HR`、`素材`、`CxO`、`SALES`、`ENG`、`Tips`、`MKTG`、`その他一時保管`、`CS` が存在する。
- `k.sato.baao@gmail.com` / `baao-docs`: `invalid_grant` のため未確認。別clientの成功を代替証拠にしない。
- workspace内にはproject-localな `drive` symlinkを確認できなかった。symlinkは必須構造ではない。

## Local ingress and symlinks

Driveへのローカル入口は機械固有の互換surfaceであり、組織の正本やproject所属を表さない。

- 必要性、実際のconsumer、mountの安定性を確認した場合だけ作る。
- team repoやGraphに `/Users/.../Library/CloudStorage/...` を記録しない。
- `drive/` がないことを欠陥とみなさない。
- symlinkを作る場合は、targetを解決し、brokenでないこと、git管理外であること、ownerが明確なことを検証する。
- project階層とDrive階層を機械的に一致させない。

## Placement decision

1. 組織の事実か。YesならGraph。
2. codeまたはversion管理すべきtextか。Yesなら所有repo。
3. 外部共同編集、binary、契約・納品・brand assetか。YesならDrive。
4. 個人だけの作業途中か。Yesなら個人workspace。team資産へ昇格した時点で正本を移す。

Driveに置く場合も、owner、対象読者、権威、更新責任者、lifecycle、Graphまたはrepoからの参照方法を明示する。

## Mutation boundary

このSkillは発見と配置判断を支援する。folder作成、移動、削除、共有設定、account間transferは、対象と影響を提示し、明示的な権限を得るまで実行しない。

- Google native fileはaccountやDriveをまたぐ移動に制約がある。
- `cp` と `mv` は同じ意味ではない。同期client上のfilesystem操作だけでserver-side結果を推測しない。
- 同名folder、未確認account、外部ownerのfileは自動整理しない。
- 変更後はAPIで新しいparent、owner、更新時刻、共有状態を再確認する。

## Audit checklist

- [ ] account/client/collectorを列挙した
- [ ] auth失敗を未確認として分離した
- [ ] Drive IDとfolder/file IDを証拠にした
- [ ] Graph・repo・Drive・個人workspaceの正本境界を説明できる
- [ ] repoまたはGraphのpointerに個人絶対パスがない
- [ ] symlinkが実在consumerに必要で、targetが解決できる
- [ ] 作成・移動・削除・共有変更には明示的な権限がある
