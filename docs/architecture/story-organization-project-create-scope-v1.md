# Architecture: project provisioning snapshot scope

## 決定

`ProjectProvisioningService.applyGraph`がexportするproject scopeを、subjectの状態に応じて最小化する。

- subjectが存在しない: `includeProjectCodes`は空配列
- subjectを再利用する: 事前検証済みのsource projectだけを追加

## 保持する契約

- 対象project自身は`projectCodes`へ常に含める。
- subject再利用の許可判定は既存preflightを正本とする。
- plan、apply、receipt、validate、rollbackの順序は変えない。

## 検証

- unit testで全project列挙が呼ばれないこととexport引数を固定する。
- integration testで成功、subject再利用、rollback、control-planeの既存フローを確認する。
- 本番readbackで60秒以内の作成と、作成後の取得・更新・archive・restoreを確認する。
