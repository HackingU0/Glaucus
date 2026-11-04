<script setup lang="ts">
import { useRoute } from 'vue-router'
import { MessageSquare, TriangleAlert } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import LangSwitch from '@/components/LangSwitch.vue'
import { t } from '@/i18n'

// The server's OAuth callback redirects here with ?error=not_member&user=<discord name> (plan.md §3 auth.ts).
const route = useRoute()
</script>

<template>
  <div class="relative flex min-h-dvh items-center justify-center bg-background bg-[linear-gradient(#ECECE7_1px,transparent_1px),linear-gradient(90deg,#ECECE7_1px,transparent_1px)] bg-size-[24px_24px] px-4 py-6">
    <div class="absolute top-4 right-4"><LangSwitch /></div>
    <div class="w-full max-w-[380px] rounded-xl border bg-card px-8 pt-9 pb-7 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <div class="flex items-center gap-2.5">
        <span aria-hidden="true" class="flex size-[30px] items-center justify-center rounded-[7px] bg-primary font-mono text-base font-medium text-primary-foreground">v</span>
        <span class="text-xl font-semibold tracking-tight">vibedoc</span>
      </div>
      <h1 class="mt-6 text-lg font-semibold">{{ t('login.title') }}</h1>

      <div v-if="route.query.error === 'not_member'" role="alert" class="mt-4 flex gap-2.5 rounded-lg border border-[#F6C5C1] bg-[#FEF3F2] px-3.5 py-3 text-[#912018]">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <div class="text-sm font-semibold">{{ t('login.deniedTitle') }}</div>
          <div class="mt-1 text-[13px] leading-relaxed">
            {{ t('login.deniedAccount') }} <code class="font-mono text-xs">{{ route.query.user }}</code>{{ t('login.deniedHint') }}
          </div>
        </div>
      </div>
      <p v-else class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ t('login.intro') }}</p>

      <!-- ponytail: goes straight to /register until server/auth.ts exists; then href="/auth/login" -->
      <Button as-child class="mt-6 h-11 w-full rounded-lg text-[15px]">
        <RouterLink to="/register" class="no-underline hover:text-primary-foreground">
          <MessageSquare class="size-[18px]" aria-hidden="true" />
          {{ t('login.button') }}
        </RouterLink>
      </Button>
    </div>
  </div>
</template>
