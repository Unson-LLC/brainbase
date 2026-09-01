<script setup>
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import OrganizationWaitlist from './OrganizationWaitlist.vue';

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #home-features-after>
      <div
        v-if="frontmatter.layout === 'home'"
        class="organization-waitlist-home"
      >
        <OrganizationWaitlist source="home" compact />
      </div>
    </template>
  </Layout>
</template>
