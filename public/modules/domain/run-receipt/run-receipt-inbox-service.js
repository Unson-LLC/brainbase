// @ts-check

import { EVENTS } from '../../core/event-bus.js';

function currentSlice(store) {
    return store.getState().runReceiptInbox || {
        status: 'idle',
        items: [],
        count: 0,
        has_more: false,
        omitted_count: 0,
        error: null,
        filters: {}
    };
}

export class RunReceiptInboxService {
    constructor({ client, appStore, eventBus }) {
        if (!client?.list) throw new TypeError('client.list is required');
        if (!appStore?.getState || !appStore?.setState) throw new TypeError('appStore is required');
        if (!eventBus?.emit) throw new TypeError('eventBus is required');
        this.client = client;
        this.appStore = appStore;
        this.eventBus = eventBus;
        this._requestSequence = 0;
        this._confirmedSnapshot = currentSlice(appStore);
    }

    async load(filters = currentSlice(this.appStore).filters) {
        const requestSequence = ++this._requestSequence;
        const previous = this._confirmedSnapshot;
        const nextFilters = { ...filters };
        this.appStore.setState({
            runReceiptInbox: {
                ...previous,
                status: 'loading',
                error: null,
                filters: nextFilters
            }
        });
        try {
            const result = await this.client.list(nextFilters);
            if (requestSequence !== this._requestSequence) return result;
            const confirmedSnapshot = {
                status: 'ready',
                ...result,
                error: null,
                filters: nextFilters
            };
            this._confirmedSnapshot = confirmedSnapshot;
            this.appStore.setState({ runReceiptInbox: confirmedSnapshot });
            await this.eventBus.emit(EVENTS.RUN_RECEIPT_INBOX_LOADED, result);
            return result;
        } catch (error) {
            if (requestSequence !== this._requestSequence) throw error;
            const message = error instanceof Error ? error.message : String(error);
            this.appStore.setState({
                runReceiptInbox: {
                    ...previous,
                    status: 'unavailable',
                    error: message,
                    filters: { ...previous.filters }
                }
            });
            await this.eventBus.emit(EVENTS.RUN_RECEIPT_INBOX_FAILED, { message });
            throw error;
        }
    }

    async setFilters(updates) {
        const filters = {
            ...currentSlice(this.appStore).filters,
            ...updates
        };
        for (const [key, value] of Object.entries(filters)) {
            if (value === '' || value === undefined || value === null) delete filters[key];
        }
        return this.load(filters);
    }
}
