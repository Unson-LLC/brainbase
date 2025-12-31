/**
 * RenameModal Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('RenameModal', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="rename-modal" class="modal">
            <input type="text" id="session-name-input" />
            <button id="rename-confirm-btn">Rename</button>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;
  });

  it('should have rename modal element', () => {
    const modal = document.getElementById('rename-modal');
    expect(modal).not.toBeNull();
  });

  it('should have session name input', () => {
    const input = document.getElementById('session-name-input');
    expect(input).not.toBeNull();
  });

  it('should have rename button', () => {
    const button = document.getElementById('rename-confirm-btn');
    expect(button).not.toBeNull();
  });
});
