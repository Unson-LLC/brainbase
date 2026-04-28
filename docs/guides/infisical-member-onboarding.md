# Infisical Member Onboarding

Last updated: 2026-04-28

## Infisicalでできること

Infisicalは、プロジェクトで使う環境変数、API key、credential、tokenを安全に管理する場所です。

メンバーは、自分の担当Projectに必要なsecretだけを確認できます。

Infisicalを使うと、次のことができます。

- Slackで`.env`やAPI keyを受け渡ししなくてよくなる。
- 自分の担当Projectの環境変数を、必要な時に確認できる。
- 自分の担当Projectに、新しいsecretを追加・更新できる。
- Claude Code / Codexに「このInfisical Projectを使って」と依頼できる。
- 担当外のsecretを見ずに、必要な範囲だけで開発・運用できる。
- 誰がどのProjectにアクセスできるかを管理しやすくなる。

逆に、Infisicalは「全員が全secretを見る場所」ではありません。見えるProjectだけが自分の担当範囲です。

メンバーは担当Project内のsecretを扱えますが、Projectそのものの追加・削除は管理者が行います。

## まずやること

1. 招待メールからアカウントを作成します。
2. `https://infisical.unson.jp` にログインします。
3. 自分の担当Projectが見えるか確認します。
4. Claude Code / Codexで作業する人は、端末でCLIログインします。

```bash
~/.local/bin/infisical login --domain https://infisical.unson.jp
```

Projectが見えない、招待メールが届かない、ログインできない場合はSlackで知らせてください。

## いつ使うか

次のような時にInfisicalを使います。

- ローカル開発で環境変数が必要な時
- Claude Code / Codexに検証や実装を依頼する時
- Vercel、AWS Lambda、Lightsailなどの設定を確認する時
- `.env`が古い、足りない、どれが正しいか分からない時
- 新しいAPI keyやtokenを追加・更新する時

## アクセスURL

```text
https://infisical.unson.jp
```

## 基本方針

- `.env`ファイルは正本ではありません。
- secretの正本はInfisicalです。
- Slack、Notion、ChatGPT、GitHub issue、docsにsecret値を書かないでください。
- 必要なProjectだけにアクセスできるようにしています。
- 本番secretは最小人数で扱います。
- Graphにはsecret値を入れず、Project名、env、path、key数などのメタデータだけを残します。

## Projectの考え方

InfisicalのProjectは「secretの境界」です。会社/プロダクト単位で分けています。

| 会社 | Project | 用途 |
|---|---|---|
| SalesTailor | `salestailor` | SalesTailor本体 |
| Unson | `unson` | Unson共通 |
| Unson | `brainbase` | brainbase / Graph / NocoDB / Honcho |
| Unson | `mana-app` | Mana Lambda |
| Unson | `dialogai-app` | DialogAI |
| Unson | `zeims` | Zeims |
| TechKnight | `techknight` | TechKnight共通 |
| TechKnight | `aitle` | Aitle |
| TechKnight | `smartfront` | SmartFront |
| BAAO | `baao-app` | BAAO |

自分に見えるProjectだけが担当範囲です。見えないProjectのsecretが必要な場合は、Slackで目的と作業内容を添えて依頼してください。

## EnvironmentとPath

Projectの中で、EnvironmentとPathを分けています。

例:

```text
Project: salestailor
Environment: development / preview / production
Path: /
```

```text
Project: brainbase
Environment: production
Path: /, /lightsail-main, /honcho
```

```text
Project: mana-app
Environment: production
Path: /lambda/mana, /lambda/mana-salestailor, /lambda/mana-techknight
```

迷ったら、まずProject、Environment、Pathの3点を確認してください。

## UIで確認する

1. `https://infisical.unson.jp` にログインします。
2. 自分の担当Projectを開きます。
3. Environmentを選びます。
4. 必要に応じてPathを切り替えます。
5. 値をコピーする場合は、作業に必要な最小限だけ扱います。

## secretを追加・更新する

担当Projectでは、必要なsecretを追加・更新できます。

追加・更新するときは、次の3点を間違えないでください。

- Project
- Environment
- Path

例:

```text
Project: salestailor
Environment: development
Path: /
Key: NEW_API_KEY
```

本番環境に追加・更新する場合は、作業目的が明確な時だけにしてください。迷う場合はSlackで相談してください。

## CLIログイン

Claude CodeやCodexにInfisicalを使わせる場合は、まず自分の端末でログインしてください。

```bash
~/.local/bin/infisical login --domain https://infisical.unson.jp
```

## Claude Code / Codexで使う

Claude Code / Codexには、secret値ではなくInfisicalの参照先を伝えます。

こうすると、agentは必要な環境変数をInfisicalから取得して作業できます。人間がsecret値をチャットに貼る必要はありません。

```text
Infisicalを使って作業してください。
Project: salestailor
Environment: development
Path: /

secret値は表示しないでください。
必要ならキー名、件数、ハッシュ、実行成否だけを報告してください。
repo配下に.envを作らないでください。
```

別Projectの例:

```text
Infisicalを使ってMana Lambdaの環境変数を確認してください。
Project: mana-app
Environment: production
Path: /lambda/mana

値は出さず、必要なキーが存在するかだけ確認してください。
```

```text
Infisicalを使ってBrainbaseのHoncho設定を確認してください。
Project: brainbase
Environment: production
Path: /honcho

secret値は表示せず、キー名と実行成否だけ報告してください。
```

悪い例:

```text
このAPI keyは xxxxx です。これを使って。
```

## やってはいけないこと

- secret値をSlackに貼る。
- secret値をGitHub、Notion、docs、AIチャットに貼る。
- repo配下に`.env`を追加する。
- 本番secretをローカルに常駐させる。
- 自分の担当外Projectのsecretを代理で共有する。
- Projectを勝手に追加・削除する。
- 退職、契約終了、担当終了後もsecretを保持する。

## 追加・変更依頼

担当Project内のsecret追加・更新は、自分で実施してかまいません。

管理者への依頼が必要なのは、次のような場合です。

- Projectへのアクセス追加
- 新しいProjectの作成
- 使わなくなったProjectの削除・整理
- 本番secretへの一時アクセス
- `.env`からInfisicalへの移行
- どのProject/Environment/Pathを見るべきか分からない

依頼時は、secret値そのものではなく、以下だけを書いてください。

```text
依頼内容: アクセス追加 / Project作成 / Project削除 / 本番一時アクセス / 移行相談 / その他
Project:
Environment:
Path:
Key名: 必要な場合のみ
目的:
期限:
```

secretの追加・更新を自分で行った場合は、必要に応じてSlackに作業内容だけ共有してください。secret値は貼らないでください。

```text
Project: salestailor
Environment: development
Path: /
Key名: NEW_API_KEY
内容: 新しい外部API連携用のkeyを追加しました。値はInfisicalに登録済みです。
```

## 困ったとき

招待メールが届かない、ログインできない、Projectが見えない場合は、Slackで知らせてください。

メールアドレスやsecret値をSlackに貼る必要はありません。本人確認が必要な場合はこちらで確認します。
