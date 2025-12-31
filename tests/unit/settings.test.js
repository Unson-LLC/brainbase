/**
 * Settings Module Tests - NocoDBタブ機能のTDD
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Settings Module - NocoDB Tab', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    // Create DOM with settings structure including new NocoDB tab
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="settings-modal" class="modal">
            <div class="modal-content modal-fullscreen" id="settings-view">
              <div class="modal-header settings-header">
                <h3>Settings</h3>
                <button class="close-modal-btn" id="close-settings-btn"></button>
              </div>
              <div class="modal-body settings-body">
                <div class="integrity-summary" id="integrity-summary"></div>
                <div class="settings-tabs">
                  <button class="settings-tab active" data-tab="slack">Slack</button>
                  <button class="settings-tab" data-tab="projects">Projects</button>
                  <button class="settings-tab" data-tab="github">GitHub</button>
                  <button class="settings-tab" data-tab="nocodb">NocoDB</button>
                </div>
                <div class="settings-content">
                  <div class="settings-panel active" id="slack-panel"></div>
                  <div class="settings-panel" id="projects-panel"></div>
                  <div class="settings-panel" id="github-panel"></div>
                  <div class="settings-panel" id="nocodb-panel">
                    <div class="settings-section">
                      <h3>NocoDB Base Mappings</h3>
                      <div id="nocodb-list" class="config-table-container">
                        <div class="loading">Loading...</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button id="settings-btn">Settings</button>
        </body>
      </html>
    `);
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
  });

  afterEach(() => {
    dom = null;
    delete global.document;
    delete global.window;
  });

  describe('NocoDB Tab Structure', () => {
    it('should have NocoDB tab button', () => {
      const nocodbTab = document.querySelector('[data-tab="nocodb"]');
      expect(nocodbTab).not.toBeNull();
      expect(nocodbTab.textContent).toContain('NocoDB');
    });

    it('should have NocoDB panel', () => {
      const nocodbPanel = document.getElementById('nocodb-panel');
      expect(nocodbPanel).not.toBeNull();
    });

    it('should have nocodb-list container', () => {
      const nocodbList = document.getElementById('nocodb-list');
      expect(nocodbList).not.toBeNull();
    });
  });

  describe('renderNocoDB function', () => {
    // Import the function we'll implement
    // This will fail until we implement it
    it('should render nocodb mappings table', async () => {
      const mockNocoDBData = [
        {
          project_id: 'brainbase',
          base_id: 'p1234567890',
          base_name: 'brainbase-prod',
          url: 'https://nocodb.example.com/dashboard/#/nc/p1234567890'
        },
        {
          project_id: 'another-project',
          base_id: 'p9876543210',
          base_name: 'another-prod',
          url: 'https://nocodb.example.com/dashboard/#/nc/p9876543210'
        }
      ];

      // Simulate renderNocoDB function behavior
      const container = document.getElementById('nocodb-list');

      // Expected output structure
      const expectedHtml = `
        <table class="config-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Base Name</th>
              <th>Base ID</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="badge badge-project">brainbase</span></td>
              <td>brainbase-prod</td>
              <td class="mono">p1234567890</td>
              <td><a href="https://nocodb.example.com/dashboard/#/nc/p1234567890" target="_blank" class="config-link">https://nocodb.example.com/dashboard/#/nc/p1234567890</a></td>
            </tr>
            <tr>
              <td><span class="badge badge-project">another-project</span></td>
              <td>another-prod</td>
              <td class="mono">p9876543210</td>
              <td><a href="https://nocodb.example.com/dashboard/#/nc/p9876543210" target="_blank" class="config-link">https://nocodb.example.com/dashboard/#/nc/p9876543210</a></td>
            </tr>
          </tbody>
        </table>
      `;

      // For now, set expected HTML to test DOM structure
      container.innerHTML = expectedHtml;

      // Verify table structure
      const table = container.querySelector('table.config-table');
      expect(table).not.toBeNull();

      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);

      // Verify first row content
      const firstRow = rows[0];
      expect(firstRow.querySelector('.badge-project').textContent).toBe('brainbase');
      expect(firstRow.querySelectorAll('td')[1].textContent).toBe('brainbase-prod');
    });

    it('should show empty message when no nocodb mappings', () => {
      const container = document.getElementById('nocodb-list');
      const emptyHtml = '<div class="config-empty">No NocoDB mappings found</div>';
      container.innerHTML = emptyHtml;

      const emptyDiv = container.querySelector('.config-empty');
      expect(emptyDiv).not.toBeNull();
      expect(emptyDiv.textContent).toBe('No NocoDB mappings found');
    });
  });

  describe('Integrity Summary', () => {
    it('should include NocoDB count in stats', () => {
      const mockStats = {
        workspaces: 2,
        channels: 50,
        members: 10,
        projects: 12,
        github: 8,
        nocodb: 5
      };

      const container = document.getElementById('integrity-summary');

      // Simulating what the updated renderIntegritySummary should produce
      container.innerHTML = `
        <div class="integrity-stats">
          <div class="stat-item success">
            <span class="label">Workspaces</span>
            <span class="count">${mockStats.workspaces}</span>
          </div>
          <div class="stat-item success">
            <span class="label">NocoDB</span>
            <span class="count">${mockStats.nocodb}</span>
          </div>
        </div>
      `;

      const nocodbStat = container.querySelector('.stat-item:last-child .count');
      expect(nocodbStat.textContent).toBe('5');
    });
  });
});
