<script setup lang="ts">
import { t } from '@/i18n'
import { STATUS, statusKey, type UiStatus } from './status'

defineProps<{ status: UiStatus }>()
</script>

<template>
  <span class="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium" :class="STATUS[status].badge">
    <span class="size-1.5 rounded-full" :class="STATUS[status].dot" />{{ t(statusKey(status)) }}
  </span>
</template>
