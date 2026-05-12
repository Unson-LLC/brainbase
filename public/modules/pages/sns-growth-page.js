import { SnsGrowthCockpitView } from '../ui/views/sns-growth-cockpit-view.js';

const root = document.getElementById('sns-growth-root');

if (root) {
    const view = new SnsGrowthCockpitView();
    view.mount(root);
}
