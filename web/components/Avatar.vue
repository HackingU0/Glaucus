<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ name: string; size?: number }>()
const PALETTE = [
  'bg-[#DCE6F5] text-[#23406E]', 'bg-[#E7E1F5] text-[#45337F]', 'bg-[#E2EFE6] text-[#24563A]', 'bg-[#F6E4D6] text-[#7A3A12]',
]
const ini = computed(() => props.name.split(/[\s_.]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase())
const color = computed(() => PALETTE[[...props.name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length])
</script>

<template>
  <span
    aria-hidden="true"
    class="flex shrink-0 items-center justify-center rounded-full font-semibold"
    :class="color"
    :style="{ width: (size ?? 28) + 'px', height: (size ?? 28) + 'px', fontSize: Math.round((size ?? 28) * 0.4) + 'px' }"
  >{{ ini }}</span>
</template>
