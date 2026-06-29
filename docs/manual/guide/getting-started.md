# 最初の導入

このページでは、Brainbase MCPをローカルで起動し、オンボーディングを始める最小手順を説明します。

## 前提

- Node.js 20以上
- npm
- Codex、Claude Code、またはMCPを登録できるAIエージェント
- Brainbaseのcheckout

```bash
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase
npm install
npm run build
```

## オンボーディングを始める

Codexで始める場合:

```bash
npm run onboard:start -- --target codex
```

Claude Codeで始める場合:

```bash
npm run onboard:start -- --target claude
```

このコマンドは、いきなり正本を書き換えるものではありません。最初にユーザーから仕事の前提、重要な関係者、判断基準、現在のプロジェクトを聞き出すための導線です。

## 最初に入れるべき文脈

Brainbaseを使い始める時は、大量のデータを取り込む前に、次の4つだけを整理します。

- 自分: 何を大事にして判断するか
- 仕事: 進行中のプロジェクトは何か
- 関係性: 重要な関係者、顧客、相談相手は誰か
- 決定: 最近決めたこと、変えてはいけない前提は何か

ここを整えずにメールや議事録を大量に入れると、AIは抽象的な要約を返しやすくなります。

## 初期ファイルを作る

ユーザーが承認したfactだけをseedします。

```bash
npm run onboard:init
npm run onboard:seed
```

初期SSOTはローカルの `~/.brainbase/personal-os/` に作られます。

## first value demo

MCP設定やsource診断より先に、最初の価値を確認します。

```bash
npm run onboard:demo -- --scenario "次の商談準備を、私の判断基準と関係者情報を踏まえて整理して"
```

出すべきものは、試すプロンプト、サンプル回答、ユーザーが説明し直さなくて済んだ価値です。

## 完了の基準

最初の導入が完了したと言えるのは、AIエージェントから次の確認ができた時です。

- Brainbase MCPのtools一覧が見える
- `get_context` でプロジェクト文脈を取得できる
- `search` で人物、組織、プロジェクトを検索できる
- AIが「この情報は正本か、候補か」を区別して話せる

設定ファイルを作っただけでは完了ではありません。
