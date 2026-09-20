# Story: OSS共通UIを組織版から再利用する

## 利用者価値

Brainbaseの利用者として、個人版で使える知識・判断・委任の画面を組織版でも同じ挙動で使い、版ごとの機能差や二重修正を避けたい。

## 受入条件

- 単一利用者で成立するUIはOSSパッケージから公開される。
- 組織・tenant・member・role・approval・audit・provider installationを必要とするUIは含めない。
- 組織版が共通UIをコピーせず、パッケージの公開subpathから読み込める。
- npm梱包結果にJS、CSS、必要なアイコンが含まれる。
- 共通UIの既存テストがOSS側で通る。
