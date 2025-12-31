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
root: /Users/ksato/workspace

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
root: /Users/ksato/workspace

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
root: /Users/ksato/workspace
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
    it('should report projects with local path but no airtable mapping as info', async () => {
      const mockConfig = `
root: /Users/ksato/workspace
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

      // Should have info about missing airtable for tech-knight
      const airtableIssue = result.issues.find(
        i => i.type === 'missing_airtable' && i.message.includes('tech-knight')
      );
      expect(airtableIssue).toBeDefined();
      expect(airtableIssue.severity).toBe('info');
    });

    it('should include airtable count in stats', async () => {
      const mockConfig = `
root: /Users/ksato/workspace
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
root: /Users/ksato/workspace

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
        base_name: 'brainbase-prod',
        url: 'https://nocodb.example.com/dashboard/#/nc/p1234567890'
      });
      expect(result[1]).toEqual({
        project_id: 'another-project',
        base_id: 'p9876543210',
        base_name: 'another-prod',
        url: 'https://nocodb.example.com/dashboard/#/nc/p9876543210'
      });
    });

    it('nocodb設定が存在しない_空配列が返される', async () => {
      const mockConfig = `
root: /Users/ksato/workspace
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
root: /Users/ksato/workspace
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
root: /Users/ksato/workspace
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
root: /Users/ksato/workspace
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
});
