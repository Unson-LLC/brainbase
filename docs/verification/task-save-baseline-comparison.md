# Task 保存 新旧比較表（固定SHA確定）— 2-qa-baseline

itsaplan: UNS-231（親 UNS-61 [unson移設 段2]）

## 目的

Task 保存の新旧（旧経路 / OSS 正式 0.44.1 / 組織版 baaca）を、2026-10-19 に採取した
証拠成果物の**固定 sha256** で突き合わせ、7 操作（作成 / 更新 / 状態遷移 / 削除 /
再試行 / 拒否 / 監査）と既存の証拠を対応づけて確定する。

## このドキュメントの状態

**未確定（原本未取得）。** この文書は移行検証用の開発ツールを説明するもので、
OSS実行時に外部の証拠や組織サービスを要求しない。証拠バンドルは呼び出し側が明示する。

現行ソースや親 PR の過去 SHA を当時の実行成果物 hash の代用にはしない（確定表の意味が
消えるため）。したがって本 PR は値を捏造せず、**取得目録を正直に出し、確定（確認）の
枠組みと雛形**だけを入れる。

## 取得（acquisition）と 確認（verification）を分ける

この道具は 2 つを厳密に分ける。**ファイルがあること＝確定、ではない。**

- **取得（acquisition）。** 証拠ファイルが `--root` に非空の JSON として在るか、在るなら
  その `sha256(bytes)`。この digest は取得した**ファイル**の同一性を指すだけで、基準の
  ソース固定SHA でも、当時の実行成果物 hash でもない。空ファイル・壊れた JSON・空の
  JSON は「未取得」。
- **確認（verification）。** 比較の各行が本当に裏取りできたか — 基準のソース固定SHA と
  実行成果物 hash、各操作と既存 11 件の証拠 ID の対応。これには原本のスキーマが要るが、
  CI・runner・箱のどこからも得られない。よって検証は**未実装**で、全行が `未確認`。
  ファイルを取得しても行は確認済みにならない（`verifyBaseline` / `verifyOperation` の
  stub がこの契約を保持する）。

## 原本が手に入ったあと（確定の手順）

1. `evidence-2026-10-19/` バンドル（下記 6 ファイル）とそのスキーマを読める場所に置く。
2. スキーマに基づく抽出・照合を `verifyBaseline` / `verifyOperation` に実装する
   （ソース固定SHA・実行成果物 hash・11 件の証拠 ID 対応を原本から取り出して検証する）。
   取得できたからといって確認済みにはしない。
3. 生成して確認を検査する:

   ```sh
   node scripts/build-task-save-baseline-table.mjs \
     --root /path/to/evidence-2026-10-19 --format markdown --require-complete \
     > docs/verification/task-save-baseline-comparison.generated.md
   ```

   `--require-complete` は未確認の行が 1 つでも残れば非ゼロ終了する。検証が未実装の現状は
   必ず非ゼロ終了する（これは意図どおり — まだ確定できない）。全行が確認済みなら 0。
4. 生成物（JSON / markdown）をこの issue にコメントし、PR を更新する。

`--root` は環境変数 `TASK_BASELINE_EVIDENCE_ROOT` でも渡せる。未指定時はエラー。

## 出力の各値の意味

- **取得目録の `sha256`** — 取得した証拠ファイルの内容ハッシュ（`sha256(bytes)`）。
  ファイルの同一性検査用。**基準の固定SHA でも実行成果物 hash でもない。**
- **基準のソース固定SHA / 実行成果物 hash** — 契約が要求する 2 種類の値。原本スキーマ
  からの抽出・照合が済むまで `未確認`。取得ファイルの digest で代用しない。
- **操作の対応する証拠ID / 新旧対応** — 既存 11 件のどれに対応するか。同じく `未確認`。

## 比較の対象

### 基準（3 種）

| 基準 | 裏づけ証拠ファイル |
| --- | --- |
| 旧経路（unson 旧実装） | `task-equivalence-current-consolidated-20261019.json` |
| OSS 正式 0.44.1 | `task-equivalence-formal-artifact-20261019.json` |
| 組織版（baaca 拡張） | `task-equivalence-formal-extension-baaca-20261019.json` |

### 7 操作の対応

| 操作 | 裏づけ証拠ファイル |
| --- | --- |
| 作成 (create) | `task-equivalence-2qa-task-mapping-20261019.json` |
| 更新 (update) | `task-equivalence-2qa-task-mapping-20261019.json` |
| 状態遷移 (status transition) | `task-equivalence-2qa-task-mapping-20261019.json` |
| 削除 (delete) | `task-equivalence-coverage-20261019.json` |
| 再試行 (retry) | `task-equivalence-coverage-20261019.json` |
| 拒否 (reject) | `task-equivalence-coverage-20261019.json` |
| 監査 (audit) | `task-transport-pg-20261019/task-transport-pg-20261019.json` |

## 要る証拠原本（基点 = evidence-2026-10-19/）

- `task-equivalence-2qa-task-mapping-20261019.json`
- `task-equivalence-formal-artifact-20261019.json`
- `task-equivalence-formal-extension-baaca-20261019.json`
- `task-equivalence-coverage-20261019.json`
- `task-equivalence-current-consolidated-20261019.json`
- `task-transport-pg-20261019/task-transport-pg-20261019.json`

## 元 Task v3 の verification_evidence（partial、原本未読のため再確認扱いにしない）

旧経路・OSS 0.44.1・Org baaca tar の固定 SHA/hash、隔離 loopback PostgreSQL での
baseline 11・拡張 6・拒否境界の対応は「済み」と記されるが原本未読。approval/監査成功
経路、prepared replay、実認証・全権限 scope、BFF/MCP 経路は「未確認」と記録されている。

## 関連

- 生成ツール: `scripts/build-task-save-baseline-table.mjs`
- テスト: `tests/task-save-baseline-table.test.js`
- 移設元: [brainbase-unson#2642](https://github.com/Unson-LLC/brainbase-unson/pull/2642)
