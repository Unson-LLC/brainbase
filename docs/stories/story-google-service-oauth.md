# Story: Googleサービスを個別に接続する

## ユーザー価値

Brainbase利用者として、Google Workspace全体を一括で許可せず、使いたい
Gmail・Googleカレンダー・Google Driveだけを選んでManaの仕事に使えるようにしたい。
そうすることで、接続画面の表示と実際に与えた権限が一致し、後から追加したサービスも
同じGoogleアカウントに対する追加許可として扱える。

## 受け入れ条件

1. 接続サービスIDは `gmail`、`google-calendar`、`google-drive` に限定する。
2. 各サービスのOAuth許可は固定scopeを使う。Gmailは `gmail.compose`、カレンダーは
   `calendar.readonly`、Driveは `drive.readonly` とする。
3. OAuth開始時の `service` をstateに署名・保存し、callbackではstateから復元したservice
   だけを接続対象にする。URLのcallback引数でサービスを差し替えられない。
4. 同じ組織・本人のGoogleアカウントに複数サービスを追加し、物理的な共有Google account
   レコードは1件に保つ。付与済みscopeとサービス別接続日時はmetadataに保存する。
5. credentialのaccess/refresh tokenはaccountレコードやAPI応答に含めず、credential store
   にだけ渡す。追加許可でGoogleがrefresh tokenを返さないときは、既存のrefresh tokenを
   消す入力を送らない。
6. 本人と組織で絞ったstatus APIが、サービス別の状態と実際のscopeを返す。秘密値は返さない。
7. 既存のGoogle Meet接続（`google-meet`レコード、開始・callback・scope）を壊さない。
8. Googleサービスの物理credential providerは既存の `google-meet` adapterを共有し、
   OAuth client参照（`google-workspace`）とUIのサービスIDを混同しない。

## 対象外

Google Calendarの書き込み、Gmail送信、Driveファイル書き込み、Google OAuth clientの
作成・配備はこのStoryには含めない。必要な追加権限は別のStoryで定義する。
