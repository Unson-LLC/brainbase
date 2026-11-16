# CI の時間切れの直し（develop）

## 何が遅かったか（測った結果）

CI ログ（NucBox `nucbox-evo-x2-wsl-linux-*`）では、ローカルの空いた機械で 1〜3 秒のテストが 10〜30 倍に伸びていました。

| テスト | ローカル（空き） | CI（develop 系の回） |
|---|---|---|
| persona-onboarding-ux「32 fixtures」 | 1.3s | 19〜33s（30s の上限に当たる） |
| company-os-hotel-pilot | 2.9s | 28.8s / 52.9s / 90s で時間切れ |
| local-web-host（ファイル全体） | 0.7s | 6.9〜35.6s |
| connected-onboarding（ファイル全体） | 0.6s | 6.4〜47.0s |

テストの処理自体は CPU より待ちが長く、CPU プロファイルでは時間の約半分が idle でした。待ちの中身は次の 3 つです。

1. **ファイル操作の数が多く、それが CI の共有ディスクで詰まる。**
   persona は 1 fixture あたり約 740 回、hotel-pilot は 1 テストで約 4 万回のファイル操作をしていました（ロック用ディレクトリの作成と削除、正本 4 ファイルの存在確認と読み込み、`sources/` の数え上げなど）。fixture は OS の一時フォルダ（ディスク）に作られており、同じディスクに 16〜20 個のジョブが書き込む CI では 1 回ごとに待たされます。
   同じ負荷をかけた再現環境で fixture を tmpfs に置くだけで、persona は 6.6s → 2.4s、hotel は 15.0s → 6.2s になりました。
2. **同じプロセスの中でロックを取り合うと、20ms ごとに確認し直していた。**
   `execution-authority` は 4 つの確認を並行して走らせ、どれも同じ正本ロックを取りに行きます。待つ側は 20ms 寝てからディレクトリロックを再確認していました。hotel-pilot ではこの待ちが 1 回の実行で 48〜52 回（空いた機械でも約 1 秒）起きていました。負荷があると持ち主の処理が遅れ、そのぶん確認の回数とファイル操作が増えます。
3. **persona は 32 本の一連の流れを 1 つのテストに詰め込んでいた。**
   1 本あたり約 40ms ですが、32 本を直列に回すので、合計が 30s の上限ひとつに収まる必要がありました。

あわせて、Foundation カタログの読み込みで、同じカタログの全件検査（ダイジェストの再計算を含む）を連続で 2 回していた箇所がありました（`readCatalog` の中で `assertFoundationCatalog` を呼んだ直後に、同じ検査を含む `foundationCatalogOrEmpty` を呼んでいた）。

## 直したこと

- `tests/helpers/fixture-root.global-setup.mjs`（`vitest.config.mjs` の `globalSetup`）
  `/dev/shm` が tmpfs のときは、実行ごとに `/dev/shm/brainbase-vitest-*` を作って `BRAINBASE_TEST_FIXTURE_ROOT` に入れ、終了時に消します。すでに設定されている値が優先されます。tmpfs が無い環境（macOS など）では従来どおり `os.tmpdir()` を使います。どこを使ったかは CI ログに `[fixture-root] ...` の 1 行で出ます。
  この変数は persona・hotel-pilot などが以前から読んでいたものの、CI では設定されていませんでした。local-web-host と connected-onboarding も読むようにしました。
- `src/ssot.ts`
  - 同じロックディレクトリを待つ同じプロセス内の呼び出しを、到着順の待ち行列にしました。前の持ち主が終わった時点で次が動くので、20ms ごとの確認が無くなります。別プロセスどうしは従来どおりディレクトリロックで守ります。時間切れ（`BRAINBASE_SSOT_LOCK_TIMEOUT_MS`、既定 5 秒）とエラー文は同じで、待ちを諦めた呼び出しがあっても、その後ろの呼び出しが持ち主の処理中に割り込むことはありません。
  - 正本 4 ファイルの読み込みと検査を並行で行い、失敗したときは従来と同じファイル順で最初の失敗を報告します。存在確認の 4 回も並行にしました。
  - `sources/` の数え上げで、ディレクトリ一覧の種別情報を使い、ファイルごとの `stat` を省きました（シンボリックリンクなど種別が分からないものだけ従来どおり `stat` で辿ります）。
  - 初期化のたびに走る補助ディレクトリとスキーマファイルの作成を並行にしました。
- `src/foundation-store.ts`：`readCatalog` の中で重複していたカタログ全件検査を 1 回にしました（残った 1 回は同じ検査で、エラーの包み方も同じです）。
- `tests/persona-onboarding-ux.test.ts`：32 本を `it.each` で 1 本ずつのテストに分けました。各 fixture の検査内容は 1 行も変えていません。各テストに既定の上限（CI では 30s）がかかり、失敗したときはどの fixture かが名前に出ます。テスト名は「…intact in fixture N of 32」に変わります。
- 時間の上限は 1 つも上げていません。persona に個別に付けていた `30_000` は外しました（CI の既定値と同じです）。hotel-pilot の `90_000` はそのままにしています。

追加したテスト：

- `tests/ssot-in-process-lock-queue.test.ts`：同じプロセス内の 12 並行の書き込みが、確認間隔を 600 秒にしても待たずに全件保存されること。到着順に、重ならずに動くこと。待ちを諦めた呼び出しの後ろの呼び出しが持ち主の処理中に動かないこと。入れ子の呼び出しは時間切れで失敗し、止まったままにならないこと。
  1 つ目と 3 つ目は、直す前のコードでは失敗します。
- `tests/fixture-root-global-setup.test.ts`：設定済みの値を優先すること、tmpfs 以外や存在しない場所では作らないこと、`/dev/shm` が tmpfs ならそこに作ること、`vitest.config.mjs` に組み込まれていること。

## 前後の所要時間

再現用の負荷として、8 コアの機械で CPU を回し続けるプロセス 16 本と、小さなファイルの書き込み・fsync・削除を繰り返すプロセス 4 本を同時に動かしました。直す前は `origin/develop`（35e91f082）の worktree、直した後はこの枝で、`CI=1 npx vitest run <file>` を 5 回ずつ実行した中央値です（単位は秒）。

| テスト | 負荷下・直す前 | 負荷下・直した後 | 空き・直す前 | 空き・直した後 |
|---|---|---|---|---|
| persona-onboarding-ux：いちばん遅い 1 テスト | 6.91 | 0.21 | 1.18 | 0.07 |
| persona-onboarding-ux：テストの合計 | 6.91 | 1.85 | 1.18 | 0.90 |
| company-os-hotel-pilot（1 テスト） | 14.12 | 4.66 | 2.76 | 2.93 |
| local-web-host：テストの合計 | 3.43 | 1.54 | 0.93 | 0.87 |
| connected-onboarding：テストの合計 | 2.09 | 0.94 | 0.72 | 0.54 |

負荷下で `npm test` 全体を 1 回ずつ流したときの値です（`CI=1 npm test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000`、同じ負荷）。

| ファイル | 直す前 | 直した後 |
|---|---|---|
| persona-onboarding-ux | 6.8s（1 テスト） | 2.1s（いちばん遅いテスト 0.22s） |
| company-os-hotel-pilot | 17.6s | 9.0s |
| local-web-host | 3.9s | 1.6s |
| connected-onboarding | 2.8s | 1.2s |

ファイル操作の数（空き、`fs.promises` を数えた値）は、persona が 23,662 → 21,646、hotel-pilot が約 39,800 → 約 34,000 でした。hotel-pilot のロック待ちの 20ms スリープは 48〜52 回 → 0 回になりました。

`npm test`（ローカル、空き）の結果は 275 files passed / 1 skipped、3448 tests passed / 16 skipped でした。上の CI と同じ引数でも通っています。負荷下の `npm test` 全体も、直す前・直した後ともに通りました（合計 347s / 385s）。この再現の負荷は CI の最悪時（10〜30 倍）より軽く（約 5 倍）、直す前の失敗そのものは再現できていません。

## 読み方の注意・残っていること

- この箱は他の作業と共有されていて、測定にばらつきがあります（hotel-pilot は直す前も直した後も、5 回中 1 回 15〜19s の外れ値が出ました）。表はすべて中央値です。
- 空いた機械での hotel-pilot は、前後で差がはっきりしません（2.6〜3.2s の範囲で揺れます）。効いているのは負荷下の待ち時間です。残りの CPU の多くは、読み込みのたびに Foundation カタログ全件のダイジェストを再計算する処理です。検査を弱めずに減らすには、内容をキーにした検査結果のキャッシュなどの設計が要るため、今回は手を付けていません。
- CI で `/dev/shm` が tmpfs かどうかは、この箱からは確かめられません。CI ログの `[fixture-root]` の行で確認してください。tmpfs でなければ、この部分は効かず、従来どおり動きます（ロック待ちと persona の分割の効果は残ります）。
- local-web-host「serves one shell with the token…」は、空いた機械でもまれに約 3 秒かかります（直す前の 12 回中 1 回、直した後の 5 回中 2 回）。直す前のコードでも起きるので、今回の変更が原因ではありません。単体で 60 回繰り返すと再現せず、原因はまだ特定できていません。
- **objective-editor「keeps objective and knowledge page guides…」は develop にはありません。** `main` と release 枝（#1022 など）にだけあるテストです。4 画面 × 9 幅 = 36 回、Chrome を毎回新しいプロファイルで起動し直しています。ローカルで実行すると 60s で時間切れになりました（この計測は負荷下の全体テストと同時に走っていました）。直すなら、Chrome を 1 回だけ起動し、幅ごとに `Emulation.setDeviceMetricsOverride` で切り替える形です。ただしこの PR（base develop）には含めておらず、`main` 側で別に直す必要があります。#1022 の local-web-host / connected-onboarding の失敗も、`main` の設定（`--maxWorkers=4`、テストの上限が既定の 5s）で起きたものです。
