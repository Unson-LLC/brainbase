import { readFileSync } from 'node:fs';

const publicMessage = JSON.parse(
  readFileSync(new URL('../publication/public-message.json', import.meta.url), 'utf8')
);
const buildSha = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local';
const buildRef = process.env.CF_PAGES_BRANCH ?? process.env.GITHUB_REF_NAME ?? 'local';
const shortBuildSha = buildSha === 'local' ? 'local' : buildSha.slice(0, 12);

export default {
  title: 'Brainbase',
  description: publicMessage.copy.definition,
  lang: 'ja-JP',
  cleanUrls: true,
  srcDir: 'manual',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/assets/brainbase-mark.svg' }]
  ],
  themeConfig: {
    siteTitle: 'Brainbase',
    nav: [
      { text: 'Brainbaseとは', link: '/guide/grand-design' },
      {
        text: '仕組み',
        items: [
          { text: 'システム構成', link: '/guide/architecture' },
          { text: 'オントロジーとは', link: '/guide/ontology' },
          { text: 'Judgment DAG', link: '/guide/judgment-system' }
        ]
      },
      { text: '10分で試す', link: '/guide/quick-start' },
      { text: '現在の状態', link: '/guide/status' },
      { text: 'リファレンス', link: '/reference/mcp-tools' },
      { text: 'GitHub', link: 'https://github.com/Unson-LLC/brainbase' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'まず理解する',
          items: [
            { text: '概要', link: '/' },
            { text: 'Brainbaseの全体像', link: '/guide/grand-design' },
            { text: '仕組みとシステム構成', link: '/guide/architecture' },
            { text: 'オントロジーとは', link: '/guide/ontology' },
            { text: 'Judgment DAGの考え方', link: '/guide/judgment-system' },
            { text: '現在の状態', link: '/guide/status' }
          ]
        },
        {
          text: '導入する',
          items: [
            { text: '最短で試す', link: '/guide/quick-start' },
            { text: '導入の5フェーズ', link: '/guide/onboarding-process' },
            { text: '1. 準備と目的', link: '/guide/getting-started' },
            { text: '2. 仕事の前提', link: '/guide/project-context' },
            { text: '3. 最初の価値', link: '/guide/first-value' },
            { text: '4. 必要な情報源', link: '/guide/source-onboarding' },
            { text: '5. 運用開始', link: '/guide/operations' }
          ]
        },
        {
          text: '運用の詳細',
          items: [
            { text: 'MCPを登録する', link: '/guide/mcp-install' },
            { text: 'Judgment Hostを登録する', link: '/guide/judgment-audit' },
            { text: '毎日と毎週の見直し', link: '/guide/daily-routines' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'リファレンス',
          items: [
            { text: 'MCPツール', link: '/reference/mcp-tools' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Cloudflare Pagesと公開経路', link: '/reference/cloudflare-pages' },
            { text: 'バージョン履歴', link: '/reference/version-history' }
          ]
        }
      ]
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Unson-LLC/brainbase' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '検索', buttonAriaLabel: '検索' },
          modal: {
            displayDetails: '詳細を表示',
            resetButtonTitle: '検索をリセット',
            backButtonTitle: '検索を閉じる',
            noResultsText: '結果がありません',
            footer: {
              selectText: '選択',
              navigateText: '移動',
              closeText: '閉じる'
            }
          }
        }
      }
    },
    editLink: {
      pattern: 'https://github.com/Unson-LLC/brainbase/edit/develop/docs/manual/:path',
      text: 'GitHubでこのページを編集'
    },
    outline: { label: 'このページ' },
    docFooter: { prev: '前へ', next: '次へ' },
    lastUpdated: { text: '最終更新' },
    returnToTopLabel: 'トップへ戻る',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: '表示モード',
    footer: {
      message: `Build ${shortBuildSha} · ${buildRef} · Released under the MIT License.`,
      copyright: 'Copyright Unson LLC'
    }
  }
};
