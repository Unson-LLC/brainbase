import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import OrganizationWaitlist from './OrganizationWaitlist.vue';
import { registerOutboundTracking } from './gtm-outbound.js';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('OrganizationWaitlist', OrganizationWaitlist);
    if (typeof window !== 'undefined' && __BRAINBASE_GTM_ENABLED__) {
      registerOutboundTracking();
    }
  }
};
