<script setup lang="ts">
// Renders text with every [needs input] as a yellow inline token that NiJump can scroll to.
import { computed } from 'vue'
import { NI } from '@/mock'

const props = defineProps<{ text: string }>()
const parts = computed(() => props.text.split(NI))
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">{{ p }}<span
    v-if="i < parts.length - 1"
    data-ni
    class="rounded-[3px] border border-ni-line bg-ni px-1 align-baseline font-mono text-[.8em] font-medium text-ni-ink"
  >[needs input]</span></template>
</template>
