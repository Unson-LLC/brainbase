export function setupNocoDBFilters({
    root = document,
    onSearchChange,
    onAssigneeChange,
    onProjectChange,
    onHideCompletedChange,
    onSync
} = {}) {
    const handlers = [];
    const getElement = (id) => (root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`));

    const register = (element, type, handler) => {
        if (!element) return;
        element.addEventListener(type, handler);
        handlers.push({ element, type, handler });
    };

    register(getElement('nocodb-task-search'), 'input', (event) => {
        onSearchChange?.(event.target.value);
    });

    register(getElement('nocodb-assignee-filter'), 'change', (event) => {
        onAssigneeChange?.(event.target.value);
    });

    register(getElement('nocodb-project-filter'), 'change', (event) => {
        onProjectChange?.(event.target.value);
    });

    register(getElement('nocodb-hide-completed'), 'change', (event) => {
        onHideCompletedChange?.(event.target.checked);
    });

    register(getElement('nocodb-sync-btn'), 'click', () => {
        return onSync?.();
    });

    return () => {
        handlers.forEach(({ element, type, handler }) => {
            element.removeEventListener(type, handler);
        });
    };
}
