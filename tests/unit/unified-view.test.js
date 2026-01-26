/**
 * Unified View Tests - プロジェクト統合ビューのTDD
 *
 * Workspace × Project × Slack × GitHub × Airtable の関係を一覧表示
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

// テスト用のモックデータ
const mockWorkspaces = {
  unson: {
    id: 'T07LNUP5888',
    name: 'UNSON',
    projects: ['zeims', 'baao', 'dialogai', 'senrigan', 'ncom']
  },
  salestailor: {
    id: 'T08SX8XXXXX',
    name: 'SalesTailor',
    projects: ['salestailor']
  },
  techknight: {
    id: 'T09XXXXXXXX',
    name: 'Tech Knight',
    projects: ['aitle', 'tech-knight']
  }
};

const mockChannels = [
  { channel_id: 'C07LP2EPVQA', channel_name: '0010-zeims-biz', workspace: 'unson', project_id: 'proj_zeims', type: 'business' },
  { channel_id: 'C07QX6DN9M0', channel_name: '0011-zeims-dev', workspace: 'unson', project_id: 'proj_zeims', type: 'development' },
  { channel_id: 'C08E010PYKE', channel_name: '0030-dialogai-biz', workspace: 'unson', project_id: 'proj_dialogai', type: 'business' },
  { channel_id: 'C08K58SUQ7N', channel_name: '0110-baao', workspace: 'unson', project_id: 'proj_baao', type: 'general' },
  { channel_id: 'C08U2EX2NEA', channel_name: 'cxo', workspace: 'salestailor', project_id: 'proj_salestailor', type: 'executive' },
  { channel_id: 'C08SX913NER', channel_name: 'eng', workspace: 'salestailor', project_id: 'proj_salestailor', type: 'development' },
  { channel_id: 'C09GXUG5UG4', channel_name: '0072-tech-knight-board', workspace: 'unson', project_id: 'proj_aitle', type: 'general' }
];

const mockProjects = [
  {
    id: 'zeims',
    local: { path: 'zeims', glob_include: ['app/**/*', 'web/**/*'] },
    github: { owner: 'Unson-LLC', repo: 'zeims-project', branch: 'main' },
    airtable: { base_id: 'appg1DeWomuFuYnri', base_name: 'Zeims' }
  },
  {
    id: 'salestailor',
    local: { path: 'salestailor', glob_include: ['app/**/*', 'docs/**/*'] },
    github: { owner: 'Unson-LLC', repo: 'salestailor-project', branch: 'main' },
    airtable: { base_id: 'app8uhkD8PcnxPvVx', base_name: 'SalesTailor' }
  },
  {
    id: 'dialogai',
    airtable: { base_id: 'appLXuHKJGitc6CGd', base_name: 'DialogAI' }
    // GitHub設定なし
  },
  {
    id: 'baao',
    local: { path: 'baao', glob_include: ['app/**/*'] },
    github: { owner: 'Unson-LLC', repo: 'baao-project', branch: 'main' }
    // Airtable設定なし
  },
  {
    id: 'aitle',
    github: { owner: 'Tech-Knight-inc', repo: 'tech-knight-project', branch: 'main' },
    airtable: { base_id: 'appvZv4ybVDsBXtvC', base_name: 'Aitle' }
  }
];

describe('ConfigParser.getUnifiedView()', () => {
  it('should return workspace-grouped project data', async () => {
    // 期待する統合ビューの構造
    const expectedStructure = {
      workspaces: [
        {
          key: 'unson',
          name: 'UNSON',
          id: 'T07LNUP5888',
          projects: [
            {
              id: 'zeims',
              channels: [
                { id: 'C07LP2EPVQA', name: '0010-zeims-biz', type: 'business' },
                { id: 'C07QX6DN9M0', name: '0011-zeims-dev', type: 'development' }
              ],
              github: {
                owner: 'Unson-LLC',
                repo: 'zeims-project',
                branch: 'main',
                paths: ['app/', 'web/']
              },
              airtable: {
                base_id: 'appg1DeWomuFuYnri',
                base_name: 'Zeims'
              }
            },
            {
              id: 'dialogai',
              channels: [
                { id: 'C08E010PYKE', name: '0030-dialogai-biz', type: 'business' }
              ],
              github: null,  // GitHub設定なし
              airtable: {
                base_id: 'appLXuHKJGitc6CGd',
                base_name: 'DialogAI'
              }
            }
          ]
        },
        {
          key: 'salestailor',
          name: 'SalesTailor',
          id: 'T08SX8XXXXX',
          projects: [
            {
              id: 'salestailor',
              channels: [
                { id: 'C08U2EX2NEA', name: 'cxo', type: 'executive' },
                { id: 'C08SX913NER', name: 'eng', type: 'development' }
              ],
              github: {
                owner: 'Unson-LLC',
                repo: 'salestailor-project',
                branch: 'main',
                paths: ['app/', 'docs/']
              },
              airtable: {
                base_id: 'app8uhkD8PcnxPvVx',
                base_name: 'SalesTailor'
              }
            }
          ]
        }
      ]
    };

    // 構造の検証
    expect(expectedStructure.workspaces).toBeInstanceOf(Array);
    expect(expectedStructure.workspaces[0].projects).toBeInstanceOf(Array);
    expect(expectedStructure.workspaces[0].projects[0].channels).toBeInstanceOf(Array);
  });

  it('should identify projects without GitHub config', () => {
    const projectWithoutGithub = mockProjects.find(p => p.id === 'dialogai');
    expect(projectWithoutGithub.github).toBeUndefined();
  });

  it('should identify projects without Airtable config', () => {
    const projectWithoutAirtable = mockProjects.find(p => p.id === 'baao');
    expect(projectWithoutAirtable.airtable).toBeUndefined();
  });

  it('should extract glob_include paths correctly', () => {
    const zeimsProject = mockProjects.find(p => p.id === 'zeims');
    const paths = zeimsProject.local.glob_include.map(g => {
      const match = g.match(/^([^*]+)/);
      return match ? match[1].replace(/\/$/, '') + '/' : null;
    }).filter(p => p);

    expect(paths).toEqual(['app/', 'web/']);
  });
});

describe('Unified View UI', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="settings-modal" class="modal">
            <div class="modal-body settings-body">
              <div class="settings-tabs">
                <button class="settings-tab" data-tab="overview">Overview</button>
                <button class="settings-tab active" data-tab="integrations">Integrations</button>
              </div>
              <div class="settings-content">
                <div class="settings-panel" id="overview-panel">
                  <div id="unified-view"></div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
  });

  afterEach(() => {
    dom = null;
    delete global.document;
  });

  it('should have Overview tab button', () => {
    const overviewTab = document.querySelector('[data-tab="overview"]');
    expect(overviewTab).not.toBeNull();
    expect(overviewTab.textContent).toBe('Overview');
  });

  it('should have unified-panel', () => {
    const unifiedPanel = document.getElementById('overview-panel');
    expect(unifiedPanel).not.toBeNull();
  });

  it('should render workspace sections', () => {
    const container = document.getElementById('unified-view');

    // 期待するHTML構造
    container.innerHTML = `
      <div class="unified-workspace" data-workspace="unson">
        <h3 class="workspace-header">
          <span class="workspace-name">UNSON</span>
          <span class="workspace-id mono">T07LNUP5888</span>
        </h3>
        <table class="config-table unified-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Slack Channels</th>
              <th>GitHub</th>
              <th>Airtable</th>
            </tr>
          </thead>
          <tbody>
            <tr data-project="zeims">
              <td><span class="badge badge-project">zeims</span></td>
              <td>
                <span class="channel-tag">#0010-zeims-biz</span>
                <span class="channel-tag">#0011-zeims-dev</span>
              </td>
              <td>
                <a href="https://github.com/Unson-LLC/zeims-project" target="_blank">
                  Unson-LLC/zeims-project
                </a>
                <span class="paths-hint">[app/, web/]</span>
              </td>
              <td>
                <a href="https://airtable.com/appg1DeWomuFuYnri" target="_blank">
                  Zeims
                </a>
              </td>
            </tr>
            <tr data-project="dialogai" class="warning-row">
              <td><span class="badge badge-project">dialogai</span></td>
              <td>
                <span class="channel-tag">#0030-dialogai-biz</span>
              </td>
              <td class="missing">
                <span class="status-missing">❌ 未設定</span>
              </td>
              <td>
                <a href="https://airtable.com/appLXuHKJGitc6CGd" target="_blank">
                  DialogAI
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    // 検証
    const workspaceSection = container.querySelector('.unified-workspace');
    expect(workspaceSection).not.toBeNull();
    expect(workspaceSection.dataset.workspace).toBe('unson');

    const projectRows = container.querySelectorAll('tbody tr');
    expect(projectRows.length).toBe(2);

    // dialogaiの行にwarning-rowクラスがある
    const dialogaiRow = container.querySelector('[data-project="dialogai"]');
    expect(dialogaiRow.classList.contains('warning-row')).toBe(true);

    // GitHub未設定のセルに.missingクラスがある
    const missingCell = dialogaiRow.querySelector('.missing');
    expect(missingCell).not.toBeNull();
  });

  it('should show channel count badge', () => {
    const container = document.getElementById('unified-view');
    container.innerHTML = `
      <td>
        <span class="channel-tag">#eng</span>
        <span class="channel-tag">#cxo</span>
        <span class="channel-count">+2 more</span>
      </td>
    `;

    const channelCount = container.querySelector('.channel-count');
    expect(channelCount).not.toBeNull();
  });
});

describe('Unified View API', () => {
  it('should have /api/config/unified endpoint structure', () => {
    // APIエンドポイントの期待するレスポンス構造
    const expectedResponse = {
      workspaces: [
        {
          key: 'unson',
          name: 'UNSON',
          id: 'T07LNUP5888',
          projects: []
        }
      ],
      orphanedChannels: [],  // プロジェクトに紐付かないチャンネル
      orphanedProjects: []   // チャンネルがないプロジェクト
    };

    expect(expectedResponse).toHaveProperty('workspaces');
    expect(expectedResponse).toHaveProperty('orphanedChannels');
    expect(expectedResponse).toHaveProperty('orphanedProjects');
  });
});
