<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import TopBar from '@/components/TopBar.vue'

const route = useRoute()
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <TopBar v-if="!route.meta.bare" :own-mobile-header="!!route.meta.ownMobileHeader" />
    <RouterView :key="route.fullPath" />
    <Toaster position="top-right" :offset="72" />
  </TooltipProvider>
</template>
