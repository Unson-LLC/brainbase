<script setup>
import { computed, ref } from 'vue';
import teaser from '../../publication/organization-teaser.json';

const props = defineProps({
  source: {
    type: String,
    default: 'unknown'
  },
  compact: {
    type: Boolean,
    default: false
  }
});

const formElement = ref(null);
const state = ref('idle');

const emailId = computed(() => `organization-waitlist-email-${props.source}`);
const isSubmitting = computed(() => state.value === 'submitting');

function setAttribution(formData) {
  if (typeof window === 'undefined') {
    return;
  }

  const pageUrl = new URL(window.location.href);
  formData.set('source_page', props.source);
  formData.set('page_url', pageUrl.toString());
  formData.set('referrer', document.referrer || '');

  for (const key of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term'
  ]) {
    formData.set(key, pageUrl.searchParams.get(key) || '');
  }
}

async function submit() {
  if (!formElement.value || isSubmitting.value) {
    return;
  }

  state.value = 'submitting';
  const formData = new FormData(formElement.value);
  setAttribution(formData);

  try {
    const response = await fetch(teaser.form.endpoint, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`waitlist submission failed with HTTP ${response.status}`);
    }

    formElement.value.reset();
    state.value = 'success';
  } catch {
    state.value = 'error';
  }
}
</script>

<template>
  <section
    id="organization-early-access"
    :class="[
      'organization-waitlist',
      { 'organization-waitlist--compact': compact }
    ]"
    :aria-labelledby="`${emailId}-title`"
  >
    <p class="organization-waitlist__eyebrow">{{ teaser.copy.eyebrow }}</p>
    <p class="organization-waitlist__tension">{{ teaser.copy.tension }}</p>

    <component
      :is="compact ? 'h2' : 'h1'"
      :id="`${emailId}-title`"
      class="organization-waitlist__headline"
    >
      {{ teaser.copy.headline }}
    </component>

    <p class="organization-waitlist__definition">
      {{ teaser.copy.definition }}
    </p>

    <div class="organization-waitlist__flow" aria-label="組織版での判断の流れ">
      <p>{{ teaser.copy.standard_case }}</p>
      <p>{{ teaser.copy.exception_case }}</p>
    </div>

    <p class="organization-waitlist__availability">
      {{ teaser.copy.availability }}
    </p>

    <div
      v-if="state === 'success'"
      class="organization-waitlist__result organization-waitlist__result--success"
      role="status"
      aria-live="polite"
    >
      {{ teaser.copy.success }}
    </div>

    <form
      v-else
      ref="formElement"
      class="organization-waitlist__form"
      :action="teaser.form.endpoint"
      method="post"
      @submit.prevent="submit"
    >
      <input type="hidden" name="form_name" :value="teaser.form.name">
      <input type="hidden" name="copy_variant" :value="teaser.form.copy_variant">
      <input type="hidden" name="_subject" :value="teaser.form.subject">
      <input type="hidden" name="consent_version" :value="teaser.form.consent_version">

      <label class="organization-waitlist__honeypot" aria-hidden="true">
        Leave this field empty
        <input
          type="text"
          name="_gotcha"
          tabindex="-1"
          autocomplete="off"
        >
      </label>

      <div class="organization-waitlist__form-row">
        <div class="organization-waitlist__field">
          <label :for="emailId">{{ teaser.copy.email_label }}</label>
          <input
            :id="emailId"
            name="_replyto"
            type="email"
            inputmode="email"
            autocomplete="email"
            maxlength="254"
            :placeholder="teaser.copy.email_placeholder"
            required
            :disabled="isSubmitting"
          >
        </div>

        <button
          type="submit"
          :disabled="isSubmitting"
          :aria-busy="isSubmitting"
        >
          {{ isSubmitting ? teaser.copy.submitting : teaser.copy.cta }}
        </button>
      </div>

      <p class="organization-waitlist__privacy">
        {{ teaser.copy.privacy_note }}
        <a
          :href="teaser.form.privacy_url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ teaser.copy.privacy_link_text }}
        </a>
      </p>

      <p
        v-if="state === 'error'"
        class="organization-waitlist__result organization-waitlist__result--error"
        role="alert"
      >
        {{ teaser.copy.error }}
        <a href="mailto:info@unson.jp?subject=Brainbase%20Organization%20先行案内">
          info@unson.jp
        </a>
      </p>
    </form>
  </section>
</template>
