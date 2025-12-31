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
    it('should report projects with local path but no airtable mapping as info', async () => {
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

      // Should have info about missing airtable for tech-knight
      const airtableIssue = result.issues.find(
        i => i.type === 'missing_airtable' && i.message.includes('tech-knight')
      );
      expect(airtableIssue).toBeDefined();
      expect(airtableIssue.severity).toBe('info');
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
});
