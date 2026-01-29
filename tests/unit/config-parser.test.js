/**
 * ConfigParser Tests - Airtableマッピング機能のTDD
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigParser } from '../../lib/config-parser.js';

// Mock fs module
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn()
  }
}));

import fs from 'fs/promises';

describe('ConfigParser', () => {
  let parser;

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new ConfigParser('/mock/codex', '/mock/config.yml');
  });

  describe('getAirtableMappings', () => {
    it('should return airtable mappings from config.yml', async () => {
      // Arrange: config.yml with airtable settings
      const mockConfig = `
root: /path/to/workspace

projects:
  - id: zeims
    local:
      path: zeims
    github:
      owner: Unson-LLC
      repo: zeims-project
      branch: main
    airtable:
      base_id: appg1DeWomuFuYnri
      base_name: Zeims

  - id: salestailor
    local:
      path: salestailor
    airtable:
      base_id: app8uhkD8PcnxPvVx
      base_name: SalesTailor

  - id: tech-knight
    local:
      path: tech-knight
    github:
      owner: Tech-Knight-inc
      repo: tech-knight-project
      branch: main
`;
      fs.readFile.mockResolvedValue(mockConfig);

      // Act
      const result = await parser.getAirtableMappings();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        project_id: 'zeims',
        base_id: 'appg1DeWomuFuYnri',
        base_name: 'Zeims',
        url: 'https://airtable.com/appg1DeWomuFuYnri'
      });
      expect(result[1]).toEqual({
        project_id: 'salestailor',
        base_id: 'app8uhkD8PcnxPvVx',
        base_name: 'SalesTailor',
        url: 'https://airtable.com/app8uhkD8PcnxPvVx'
      });
    });

    it('should return empty array when no airtable mappings exist', async () => {
      const mockConfig = `
root: /path/to/workspace

projects:
  - id: tech-knight
    local:
      path: tech-knight
    github:
      owner: Tech-Knight-inc
      repo: tech-knight-project
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getAirtableMappings();

      expect(result).toEqual([]);
    });

    it('should handle file read errors gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await parser.getAirtableMappings();

      expect(result).toEqual([]);
    });
  });

  describe('getAll - includes airtable', () => {
    it('should include airtable in the response', async () => {
      // Mock all file reads
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: zeims
    airtable:
      base_id: appg1DeWomuFuYnri
      base_name: Zeims
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.getAll();

      expect(result).toHaveProperty('airtable');
      expect(result.airtable).toHaveLength(1);
      expect(result.airtable[0].project_id).toBe('zeims');
    });
  });

  describe('checkIntegrity - airtable validation', () => {
    it('should not report missing airtable mappings (Airtable validation disabled)', async () => {
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: zeims
    local:
      path: zeims
    airtable:
      base_id: appg1DeWomuFuYnri
      base_name: Zeims
  - id: tech-knight
    local:
      path: tech-knight
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.checkIntegrity();

      // Airtable validation is disabled, so no missing_airtable issues should be reported
      const airtableIssue = result.issues.find(
        i => i.type === 'missing_airtable' && i.message.includes('tech-knight')
      );
      expect(airtableIssue).toBeUndefined();
    });

    it('should include airtable count in stats', async () => {
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: zeims
    airtable:
      base_id: appg1DeWomuFuYnri
      base_name: Zeims
  - id: salestailor
    airtable:
      base_id: app8uhkD8PcnxPvVx
      base_name: SalesTailor
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.checkIntegrity();

      expect(result.stats.airtable).toBe(2);
    });
  });

  describe('getNocoDBMappings', () => {
    it('config.ymlのnocodb設定_正しく変換されたマッピングが返される', async () => {
      // Arrange: config.yml with nocodb settings
      const mockConfig = `
root: /path/to/workspace

projects:
  - id: brainbase
    local:
      path: brainbase
    nocodb:
      base_id: p1234567890
      base_name: brainbase-prod
      url: https://nocodb.example.com/dashboard/#/nc/p1234567890

  - id: another-project
    local:
      path: another-project
    nocodb:
      base_id: p9876543210
      base_name: another-prod
      url: https://nocodb.example.com/dashboard/#/nc/p9876543210

  - id: no-nocodb-project
    local:
      path: no-nocodb-project
`;

      fs.readFile.mockResolvedValue(mockConfig);

      // Act
      const result = await parser.getNocoDBMappings();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        project_id: 'brainbase',
        base_id: 'p1234567890',
        legacy_base_id: 'p1234567890',
        nocodb_project_id: '',
        base_name: 'brainbase-prod',
        url: 'https://nocodb.example.com/dashboard/#/nc/p1234567890'
      });
      expect(result[1]).toEqual({
        project_id: 'another-project',
        base_id: 'p9876543210',
        legacy_base_id: 'p9876543210',
        nocodb_project_id: '',
        base_name: 'another-prod',
        url: 'https://nocodb.example.com/dashboard/#/nc/p9876543210'
      });
    });

    it('nocodb設定が存在しない_空配列が返される', async () => {
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: brainbase
    local:
      path: brainbase
`;

      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getNocoDBMappings();

      expect(result).toEqual([]);
    });

    it('should handle file read errors gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await parser.getNocoDBMappings();

      expect(result).toEqual([]);
    });
  });

  describe('getAll - includes nocodb', () => {
    it('should include nocodb in the response', async () => {
      // Mock all file reads
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: brainbase
    nocodb:
      base_id: p1234567890
      base_name: brainbase-prod
      url: https://nocodb.example.com/dashboard/#/nc/p1234567890
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.getAll();

      expect(result).toHaveProperty('nocodb');
      expect(result.nocodb).toHaveLength(1);
      expect(result.nocodb[0].project_id).toBe('brainbase');
    });
  });

  describe('checkIntegrity - nocodb validation', () => {
    it('should report projects with local path but no nocodb mapping as info', async () => {
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: brainbase
    local:
      path: brainbase
    nocodb:
      base_id: p1234567890
      base_name: brainbase-prod
      url: https://nocodb.example.com/dashboard/#/nc/p1234567890
  - id: no-nocodb-project
    local:
      path: no-nocodb-project
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.checkIntegrity();

      // Should have info about missing nocodb for no-nocodb-project
      const nocodbIssue = result.issues.find(
        i => i.type === 'missing_nocodb' && i.message.includes('no-nocodb-project')
      );
      expect(nocodbIssue).toBeDefined();
      expect(nocodbIssue.severity).toBe('info');
    });

    it('should include nocodb count in stats', async () => {
      const mockConfig = `
root: /path/to/workspace
projects:
  - id: brainbase
    nocodb:
      base_id: p1234567890
      base_name: brainbase-prod
      url: https://nocodb.example.com/dashboard/#/nc/p1234567890
  - id: another-project
    nocodb:
      base_id: p9876543210
      base_name: another-prod
      url: https://nocodb.example.com/dashboard/#/nc/p9876543210
`;
      const mockWorkspaces = 'workspaces: {}';
      const mockChannels = 'channels: []';
      const mockMembers = 'members: []';

      fs.readFile.mockImplementation((filepath) => {
        if (filepath.includes('config.yml')) return Promise.resolve(mockConfig);
        if (filepath.includes('workspaces.yml')) return Promise.resolve(mockWorkspaces);
        if (filepath.includes('channels.yml')) return Promise.resolve(mockChannels);
        if (filepath.includes('members.yml')) return Promise.resolve(mockMembers);
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await parser.checkIntegrity();

      expect(result.stats.nocodb).toBe(2);
    });
  });

  describe('getOrganizations', () => {
    it('config.ymlのorganizations設定_法人一覧が返される', async () => {
      const mockConfig = `
root: /path/to/workspace

organizations:
  - id: unson
    name: UNSON LLC
    ceo: ksato
    projects: [brainbase, salestailor, mana]

  - id: tech-knight
    name: Tech Knight Inc.
    ceo: yamada
    projects: [tech-knight]
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'unson',
        name: 'UNSON LLC',
        ceo: 'ksato',
        projects: ['brainbase', 'salestailor', 'mana']
      });
      expect(result[1]).toEqual({
        id: 'tech-knight',
        name: 'Tech Knight Inc.',
        ceo: 'yamada',
        projects: ['tech-knight']
      });
    });

    it('organizations設定が存在しない_空配列が返される', async () => {
      const mockConfig = `
root: /path/to/workspace
projects: []
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getOrganizations();

      expect(result).toEqual([]);
    });

    it('ファイル読み込みエラー_空配列が返される', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await parser.getOrganizations();

      expect(result).toEqual([]);
    });
  });

  describe('getDependencies', () => {
    it('config.ymlのdependencies設定_依存関係マッピングが返される', async () => {
      const mockConfig = `
root: /path/to/workspace

dependencies:
  brainbase:
    depends_on: []
  mana:
    depends_on: [brainbase]
  salestailor:
    depends_on: [brainbase, mana]
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getDependencies();

      expect(result).toEqual({
        brainbase: { depends_on: [] },
        mana: { depends_on: ['brainbase'] },
        salestailor: { depends_on: ['brainbase', 'mana'] }
      });
    });

    it('dependencies設定が存在しない_空オブジェクトが返される', async () => {
      const mockConfig = `
root: /path/to/workspace
projects: []
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getDependencies();

      expect(result).toEqual({});
    });

    it('ファイル読み込みエラー_空オブジェクトが返される', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await parser.getDependencies();

      expect(result).toEqual({});
    });
  });

  describe('getNotifications', () => {
    it('config.ymlのnotifications設定_通知設定が返される', async () => {
      const mockConfig = `
root: /path/to/workspace

notifications:
  channels:
    slack: true
    web: true
    email: false
  dnd:
    enabled: true
    start: 22
    end: 9
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getNotifications();

      expect(result).toEqual({
        channels: { slack: true, web: true, email: false },
        dnd: { enabled: true, start: 22, end: 9 }
      });
    });

    it('notifications設定が存在しない_空設定が返される', async () => {
      const mockConfig = `
root: /path/to/workspace
projects: []
`;
      fs.readFile.mockResolvedValue(mockConfig);

      const result = await parser.getNotifications();

      expect(result).toEqual({
        channels: {},
        dnd: {}
      });
    });

    it('ファイル読み込みエラー_空設定が返される', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await parser.getNotifications();

      expect(result).toEqual({
        channels: {},
        dnd: {}
      });
    });
  });
});
