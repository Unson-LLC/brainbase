import { EVENTS } from './event-bus.js';

const DEFAULT_PLUGINS_CONFIG = {
    enabled: [],
    disabled: []
};

export class PluginManager {
    constructor({ eventBus, store, apiClient, context = {} } = {}) {
        this.eventBus = eventBus;
        this.store = store;
        this.apiClient = apiClient || this._createDefaultApiClient();
        this.context = context;
        this.plugins = new Map();
        this.slots = new Map();
        this.config = { plugins: { ...DEFAULT_PLUGINS_CONFIG } };
        this.enabledConfig = new Set();
        this.disabledConfig = new Set();
        this.activePluginIds = new Set();
        this.failedPlugins = new Map();
        this.envStatus = {};
        this.enableAllByDefault = false;
    }

    setContext(context) {
        this.context = { ...this.context, ...context };
    }

    registerSlotsFromDOM(root = document) {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('[data-slot]').forEach(element => {
            const slotId = element.getAttribute('data-slot');
            if (slotId) {
                this.registerSlot(slotId, element);
            }
        });
    }

    registerSlot(slotId, element) {
        if (!slotId || !element) return;
        if (!this.slots.has(slotId)) {
            this.slots.set(slotId, []);
        }
        this.slots.get(slotId).push(element);
    }

    getSlot(slotId) {
        const entries = this.slots.get(slotId);
        return entries?.[0] || null;
    }

    getSlots(slotId) {
        return this.slots.get(slotId) || [];
    }

    registerPlugin(plugin) {
        if (!plugin?.id) {
            throw new Error('Plugin must provide id');
        }
        if (this.plugins.has(plugin.id)) {
            console.warn(`Plugin ${plugin.id} already registered`);
            return;
        }

        const normalized = {
            ...plugin,
            slots: plugin.slots || {},
            requirements: plugin.requirements || {},
            enabled: false,
            activeMounts: new Map()
        };

        this.plugins.set(plugin.id, normalized);

        if (this.eventBus?.emit) {
            this.eventBus.emit(EVENTS.PLUGIN_REGISTERED, { pluginId: plugin.id });
        }
    }

    getPlugin(id) {
        return this.plugins.get(id);
    }

    async loadConfig() {
        const config = await this.apiClient.getConfig();
        const plugins = config?.plugins || DEFAULT_PLUGINS_CONFIG;
        const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];
        const disabled = Array.isArray(plugins.disabled) ? plugins.disabled : [];
        this.enableAllByDefault = enabled.length === 0 && disabled.length === 0;

        this.config = {
            ...config,
            plugins: { enabled, disabled }
        };
        this.enabledConfig = new Set(enabled);
        this.disabledConfig = new Set(disabled);

        if (this.store?.setState) {
            this.store.setState({
                plugins: {
                    enabled,
                    disabled,
                    active: Array.from(this.activePluginIds),
                    failed: Object.fromEntries(this.failedPlugins)
                }
            });
        }

        if (this.eventBus?.emit) {
            await this.eventBus.emit(EVENTS.PLUGIN_CONFIG_LOADED, { enabled, disabled });
        }
    }

    isEnabled(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (plugin?.layer === 'core' || plugin?.core === true) {
            return true;
        }
        if (this.disabledConfig.has(pluginId)) {
            return false;
        }
        if (this.enableAllByDefault) {
            return true;
        }
        return this.enabledConfig.has(pluginId);
    }

    isActive(pluginId) {
        return Boolean(this.plugins.get(pluginId)?.enabled);
    }

    async enableConfiguredPlugins() {
        await this._ensureEnvStatusForEnabled();

        for (const [pluginId, plugin] of this.plugins) {
            if (this.isEnabled(pluginId)) {
                await this.enablePlugin(pluginId);
            } else {
                this._hidePluginSlots(plugin);
            }
        }
    }

    async enablePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin ${pluginId} not found`);
        }
        if (plugin.enabled) return;

        const requirementCheck = this._checkRequirements(plugin);
        if (!requirementCheck.ok) {
            this._recordFailedPlugin(pluginId, requirementCheck);
            this._hidePluginSlots(plugin);
            if (this.eventBus?.emit) {
                await this.eventBus.emit(EVENTS.PLUGIN_REQUIREMENTS_FAILED, {
                    pluginId,
                    missingConfig: requirementCheck.missingConfig,
                    missingEnv: requirementCheck.missingEnv
                });
            }
            return;
        }

        const activeMounts = new Map();
        for (const [slotId, slotDef] of Object.entries(plugin.slots || {})) {
            const containers = this.getSlots(slotId);
            if (containers.length === 0) {
                if (this.eventBus?.emit) {
                    await this.eventBus.emit(EVENTS.PLUGIN_SLOT_MISSING, { pluginId, slotId });
                }
                continue;
            }

            const slotConfig = typeof slotDef === 'function' ? { mount: slotDef } : (slotDef || {});
            const mountFn = slotConfig.mount;
            const manageVisibility = slotConfig.manageVisibility !== false;
            for (const container of containers) {
                if (manageVisibility) {
                    this._setSlotVisibility(container, true);
                }
                if (!mountFn) continue;
                const unmount = await mountFn({
                    container,
                    slotId,
                    pluginId,
                    eventBus: this.eventBus,
                    store: this.store,
                    pluginManager: this,
                    config: this.config,
                    context: this.context
                });
                if (typeof unmount === 'function') {
                    activeMounts.set(`${slotId}:${container.id || container.className}`, unmount);
                }
            }
        }

        plugin.enabled = true;
        plugin.activeMounts = activeMounts;
        this.activePluginIds.add(pluginId);
        this._syncStoreState();

        if (this.eventBus?.emit) {
            await this.eventBus.emit(EVENTS.PLUGIN_ENABLED, { pluginId });
        }
    }

    disablePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin || !plugin.enabled) return;

        for (const [slotId, slotDef] of Object.entries(plugin.slots || {})) {
            const containers = this.getSlots(slotId);
            const slotConfig = typeof slotDef === 'function' ? { mount: slotDef } : (slotDef || {});
            const manageVisibility = slotConfig.manageVisibility !== false;
            if (!manageVisibility) continue;
            containers.forEach(container => this._setSlotVisibility(container, false));
        }

        plugin.activeMounts.forEach(unmount => {
            try {
                unmount();
            } catch (error) {
                console.error(`Failed to unmount plugin ${pluginId}:`, error);
            }
        });

        plugin.activeMounts.clear();
        plugin.enabled = false;
        this.activePluginIds.delete(pluginId);
        this._syncStoreState();

        if (this.eventBus?.emit) {
            this.eventBus.emit(EVENTS.PLUGIN_DISABLED, { pluginId });
        }
    }

    _checkRequirements(plugin) {
        const requirements = plugin.requirements || {};
        const missingConfig = (requirements.configKeys || []).filter(key => {
            const value = this._getConfigValue(this.config, key);
            return value === undefined || value === null;
        });
        const missingEnv = (requirements.envKeys || []).filter(key => !this.envStatus[key]);

        return {
            ok: missingConfig.length === 0 && missingEnv.length === 0,
            missingConfig,
            missingEnv
        };
    }

    _getConfigValue(source, path) {
        if (!path) return undefined;
        const parts = path.split('.');
        let current = source;
        for (const part of parts) {
            if (current && Object.prototype.hasOwnProperty.call(current, part)) {
                current = current[part];
            } else {
                return undefined;
            }
        }
        return current;
    }

    async _ensureEnvStatusForEnabled() {
        const envKeys = new Set();
        for (const [pluginId, plugin] of this.plugins) {
            if (!this.isEnabled(pluginId)) continue;
            (plugin.requirements?.envKeys || []).forEach(key => envKeys.add(key));
        }
        if (envKeys.size === 0) return;
        await this.ensureEnvStatus(Array.from(envKeys));
    }

    async ensureEnvStatus(envKeys) {
        const missingKeys = envKeys.filter(key => typeof this.envStatus[key] === 'undefined');
        if (missingKeys.length === 0) return;
        const status = await this.apiClient.getEnvStatus(missingKeys);
        this.envStatus = { ...this.envStatus, ...status };
    }

    _recordFailedPlugin(pluginId, requirementCheck) {
        this.failedPlugins.set(pluginId, {
            missingConfig: requirementCheck.missingConfig,
            missingEnv: requirementCheck.missingEnv
        });
        this._syncStoreState();
    }

    _syncStoreState() {
        if (!this.store?.setState) return;
        this.store.setState({
            plugins: {
                enabled: Array.from(this.enabledConfig),
                disabled: Array.from(this.disabledConfig),
                active: Array.from(this.activePluginIds),
                failed: Object.fromEntries(this.failedPlugins)
            }
        });
    }

    _setSlotVisibility(container, isVisible) {
        if (!container) return;
        container.style.display = isVisible ? '' : 'none';
    }

    _hidePluginSlots(plugin) {
        if (!plugin) return;
        for (const [slotId, slotDef] of Object.entries(plugin.slots || {})) {
            const slotConfig = typeof slotDef === 'function' ? { mount: slotDef } : (slotDef || {});
            const manageVisibility = slotConfig.manageVisibility !== false;
            if (!manageVisibility) continue;
            const containers = this.getSlots(slotId);
            containers.forEach(container => this._setSlotVisibility(container, false));
        }
    }

    _createDefaultApiClient() {
        return {
            async getConfig() {
                const response = await fetch('/api/config');
                if (!response.ok) {
                    throw new Error('Failed to fetch config');
                }
                return response.json();
            },
            async getEnvStatus(keys) {
                if (!keys || keys.length === 0) return {};
                const params = new URLSearchParams({ keys: keys.join(',') });
                const response = await fetch(`/api/config/env?${params.toString()}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch env status');
                }
                const data = await response.json();
                return data.keys || {};
            }
        };
    }
}
