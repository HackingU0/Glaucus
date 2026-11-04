<script setup lang="ts">
// "N items need input" chip; each click scrolls to the next [data-ni] element on the page.
import { ref } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { t } from '@/i18n'

const props = defineProps<{ count: number; block?: boolean }>()
const idx = ref(0)

function next() {
  const els = document.querySelectorAll<HTMLElement>('[data-ni]')
  const visible = [...els].filter((el) => el.offsetParent !== null)
  if (!visible.length) return
  const el = visible[idx.value % visible.length]
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (el.matches('input, textarea')) el.focus({ preventScroll: true })
  idx.value = (idx.value + 1) % Math.max(1, props.count)
}
</script>

<template>
  <button
    type="button"
    class="inline-flex cursor-pointer items-center gap-1.5 border border-ni-line bg-ni font-semibold text-ni-ink"
    :class="block ? 'h-11 w-full rounded-lg px-3 text-sm' : 'h-6 rounded-full px-2.5 text-xs'"
    @click="next"
  >
    <TriangleAlert :class="block ? 'size-4' : 'size-3.5'" aria-hidden="true" />
    {{ t('ni.count', { n: count }) }}
    <span v-if="block" class="flex-1" />
    <span class="font-normal" :class="block ? 'text-[13px]' : 'opacity-80'">{{ t('ni.jump', { i: (idx % count) + 1, n: count }) }}</span>
  </button>
</template>
