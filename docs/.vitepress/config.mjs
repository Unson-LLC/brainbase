export default {
  title: 'Brainbase',
  description: 'CodexやClaude Codeに自分の仕事文脈を渡すためのBrainbase MCPマニュアル',
  lang: 'ja-JP',
  cleanUrls: true,
  srcDir: 'manual',
  themeConfig: {
    siteTitle: 'Brainbase Manual',
    nav: [
      { text: 'ガイド', link: '/guide/grand-design' },
      { text: 'リファレンス', link: '/reference/mcp-tools' },
      { text: 'GitHub', link: 'https://github.com/Unson-LLC/brainbase' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'はじめに',
          items: [
            { text: '概要', link: '/' },
            { text: '全体像', link: '/guide/grand-design' },
            { text: 'Brainbaseとは', link: '/guide/what-is-brainbase' },
            { text: '最初の導入', link: '/guide/getting-started' },
            { text: 'MCPを登録する', link: '/guide/mcp-install' }
          ]
        },
        {
          text: '使い始める',
          items: [
            { text: 'プロジェクト文脈を作る', link: '/guide/project-context' },
            { text: 'メール・カレンダー・ドライブ・タスク', link: '/guide/source-onboarding' },
            { text: '日次ルーティン', link: '/guide/daily-routines' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'リファレンス',
          items: [
            { text: 'MCPツール', link: '/reference/mcp-tools' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Cloudflare Pages', link: '/reference/cloudflare-pages' },
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
      message: 'Released under the MIT License.',
      copyright: 'Copyright Unson LLC'
    }
  }
};
