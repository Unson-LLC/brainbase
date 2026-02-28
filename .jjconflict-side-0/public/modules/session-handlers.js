/**
 * Session Handlers
 * セッションリストの共通イベントハンドラー（デスクトップ・モバイル共通）
 */

import { eventBus, EVENTS } from './core/event-bus.js';

/**
 * セクションヘッダー（「作業中」「一時停止」）の展開/折りたたみハンドラーを設定
 * @param {HTMLElement} container - セッションリストのコンテナ要素
 */
export function attachSectionHeaderHandlers(container) {
    container.querySelectorAll('.session-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const sectionDiv = header.closest('.session-section');
            const childrenDiv = sectionDiv?.querySelector('.session-section-children');

            if (childrenDiv) {
                const isCurrentlyExpanded = childrenDiv.style.display !== 'none';
                childrenDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';

                const icon = header.querySelector('i');
                if (icon) {
                    icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'chevron-right' : 'chevron-down');
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });
    });
}

/**
 * プロジェクトグループヘッダーの展開/折りたたみハンドラーを設定
 * @param {HTMLElement} container - セッションリストのコンテナ要素
 */
export function attachGroupHeaderHandlers(container) {
    container.querySelectorAll('.session-group-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (!e.target.closest('.add-project-session-btn')) {
                const groupDiv = header.closest('.session-project-group');
                const childrenContainer = groupDiv.querySelector('.session-project-children');

                if (childrenContainer) {
                    const isCurrentlyExpanded = childrenContainer.style.display !== 'none';
                    childrenContainer.style.display = isCurrentlyExpanded ? 'none' : 'block';

                    const icon = header.querySelector('.folder-icon i');
                    if (icon) {
                        icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'folder' : 'folder-open');
                        if (window.lucide) window.lucide.createIcons();
                    }
                }
            }
        });
    });
}

/**
 * セッションメニュートグル（3点メニュー）のハンドラーを設定
 * @param {HTMLElement} container - セッションリストのコンテナ要素
 */
export function attachMenuToggleHandlers(container) {
    container.querySelectorAll('.session-child-row').forEach(row => {
        const menuToggle = row.querySelector('.session-menu-toggle');
        const dropdownMenu = row.querySelector('.session-dropdown-menu');

        if (menuToggle && dropdownMenu) {
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();

                // Close all other open menus
                document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
                    if (menu !== dropdownMenu) {
                        menu.classList.add('hidden');
                    }
                });

                // Toggle this menu
                const isOpening = dropdownMenu.classList.contains('hidden');
                dropdownMenu.classList.toggle('hidden');

                // オーバーレイの表示/非表示
                const menuOverlay = document.getElementById('menu-overlay');
                if (menuOverlay) {
                    if (isOpening) {
                        // メニューを開く場合、オーバーレイを表示
                        menuOverlay.classList.remove('hidden');
                    } else {
                        // メニューを閉じる場合、他に開いているメニューがなければオーバーレイを非表示
                        const hasOpenMenu = Array.from(document.querySelectorAll('.session-dropdown-menu'))
                            .some(menu => !menu.classList.contains('hidden'));
                        if (!hasOpenMenu) {
                            menuOverlay.classList.add('hidden');
                        }
                    }
                }
            });
        }
    });
}

/**
 * セッション行のクリックハンドラーを設定（セッション切り替え用）
 * @param {HTMLElement} container - セッションリストのコンテナ要素
 * @param {Function} onSessionClick - セッションクリック時のコールバック (sessionId) => void
 */
export function attachSessionRowClickHandlers(container, onSessionClick) {
    container.querySelectorAll('.session-child-row').forEach(row => {
        row.addEventListener('click', (e) => {
            // ボタンクリックは無視
            if (e.target.closest('button')) return;
            const sessionId = row.dataset.id;
            if (sessionId && onSessionClick) {
                onSessionClick(sessionId);
            }
        });
    });
}

/**
 * プロジェクト追加ボタン（+）のハンドラーを設定
 * @param {HTMLElement} container - セッションリストのコンテナ要素
 * @param {Function} onAddSession - セッション追加時のコールバック (project) => void
 */
export function attachAddProjectSessionHandlers(container, onAddSession) {
    container.querySelectorAll('.add-project-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const project = btn.dataset.project;
            if (project && onAddSession) {
                onAddSession(project);
            }
        });
    });
}
