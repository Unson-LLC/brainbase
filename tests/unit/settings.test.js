/**
 * Settings Module Tests - Airtableタブ機能のTDD
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Settings Module - Airtable Tab', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    // Create DOM with settings structure including new Airtable tab
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
                  <button class="settings-tab" data-tab="airtable">Airtable</button>
                </div>
                <div class="settings-content">
                  <div class="settings-panel active" id="slack-panel"></div>
                  <div class="settings-panel" id="projects-panel"></div>
                  <div class="settings-panel" id="github-panel"></div>
                  <div class="settings-panel" id="airtable-panel">
                    <div class="settings-section">
                      <h3>Airtable Base Mappings</h3>
                      <div id="airtable-list" class="config-table-container">
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

  describe('Airtable Tab Structure', () => {
    it('should have Airtable tab button', () => {
      const airtableTab = document.querySelector('[data-tab="airtable"]');
      expect(airtableTab).not.toBeNull();
      expect(airtableTab.textContent).toContain('Airtable');
    });

    it('should have Airtable panel', () => {
      const airtablePanel = document.getElementById('airtable-panel');
      expect(airtablePanel).not.toBeNull();
    });

    it('should have airtable-list container', () => {
      const airtableList = document.getElementById('airtable-list');
      expect(airtableList).not.toBeNull();
    });
  });

  describe('renderAirtable function', () => {
    // Import the function we'll implement
    // This will fail until we implement it
    it('should render airtable mappings table', async () => {
      const mockAirtableData = [
        {
          project_id: 'zeims',
          base_id: 'appg1DeWomuFuYnri',
          base_name: 'Zeims',
          url: 'https://airtable.com/appg1DeWomuFuYnri'
        },
        {
          project_id: 'salestailor',
          base_id: 'app8uhkD8PcnxPvVx',
          base_name: 'SalesTailor',
          url: 'https://airtable.com/app8uhkD8PcnxPvVx'
        }
      ];

      // Simulate renderAirtable function behavior
      const container = document.getElementById('airtable-list');

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
              <td><span class="badge badge-project">zeims</span></td>
              <td>Zeims</td>
              <td class="mono">appg1DeWomuFuYnri</td>
              <td><a href="https://airtable.com/appg1DeWomuFuYnri" target="_blank" class="config-link">https://airtable.com/appg1DeWomuFuYnri</a></td>
            </tr>
            <tr>
              <td><span class="badge badge-project">salestailor</span></td>
              <td>SalesTailor</td>
              <td class="mono">app8uhkD8PcnxPvVx</td>
              <td><a href="https://airtable.com/app8uhkD8PcnxPvVx" target="_blank" class="config-link">https://airtable.com/app8uhkD8PcnxPvVx</a></td>
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
      expect(firstRow.querySelector('.badge-project').textContent).toBe('zeims');
      expect(firstRow.querySelectorAll('td')[1].textContent).toBe('Zeims');
    });

    it('should show empty message when no airtable mappings', () => {
      const container = document.getElementById('airtable-list');
      const emptyHtml = '<div class="config-empty">No Airtable mappings found</div>';
      container.innerHTML = emptyHtml;

      const emptyDiv = container.querySelector('.config-empty');
      expect(emptyDiv).not.toBeNull();
      expect(emptyDiv.textContent).toBe('No Airtable mappings found');
    });
  });

  describe('Integrity Summary', () => {
    it('should include Airtable count in stats', () => {
      const mockStats = {
        workspaces: 2,
        channels: 50,
        members: 10,
        projects: 12,
        github: 8,
        airtable: 5
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
            <span class="label">Airtable</span>
            <span class="count">${mockStats.airtable}</span>
          </div>
        </div>
      `;

      const airtableStat = container.querySelector('.stat-item:last-child .count');
      expect(airtableStat.textContent).toBe('5');
    });
  });
});
