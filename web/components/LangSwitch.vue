<script setup lang="ts">
import { Languages } from '@lucide/vue'
import { LOCALES, locale, t } from '@/i18n'
</script>

<template>
  <label class="relative inline-flex items-center text-sm text-muted-foreground">
    <Languages class="pointer-events-none absolute left-2.5 size-4" aria-hidden="true" />
    <span class="sr-only">{{ t('common.language') }}</span>
    <select v-model="locale" class="h-9 appearance-none rounded-md border border-input bg-card pr-3 pl-8 text-sm text-foreground">
      <option v-for="(name, code) in LOCALES" :key="code" :value="code">{{ name }}</option>
    </select>
  </label>
</template>
