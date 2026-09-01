import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import OrganizationWaitlist from './OrganizationWaitlist.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('OrganizationWaitlist', OrganizationWaitlist);
  }
};
