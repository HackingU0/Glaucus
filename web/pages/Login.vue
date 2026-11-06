<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { MessageSquare, TriangleAlert } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import LangSwitch from '@/components/LangSwitch.vue'
import { t } from '@/i18n'

// The server's OAuth callback redirects here with ?error=not_member&user=<discord name> (plan.md §3 auth.ts).
const route = useRoute()

// Demo mode (DEV_LOGIN=1) answers with test accounts; otherwise 404 → the Discord button. undefined = still asking.
const accounts = ref<{ id: string; name: string; admin: number }[]>()
fetch('/auth/dev-users')
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => [])
  .then((list) => (accounts.value = list))
</script>

<template>
  <div class="relative flex min-h-dvh items-center justify-center bg-background bg-[linear-gradient(#ECECE7_1px,transparent_1px),linear-gradient(90deg,#ECECE7_1px,transparent_1px)] bg-size-[24px_24px] px-4 py-6">
    <div class="absolute top-4 right-4"><LangSwitch /></div>
    <div class="w-full max-w-[380px] rounded-xl border bg-card px-8 pt-9 pb-7 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <div class="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" class="size-[30px]">
        <span class="text-xl font-semibold tracking-tight">Glaucus</span>
      </div>
      <h1 class="mt-6 text-lg font-semibold">{{ t('login.title') }}</h1>

      <template v-if="accounts?.length">
        <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ t('login.demoIntro') }}</p>
        <ul class="mt-5 flex flex-col gap-2">
          <li v-for="a in accounts" :key="a.id">
            <Button as-child variant="outline" class="h-10 w-full justify-between rounded-lg">
              <a :href="`/auth/dev?id=${a.id}&admin=${a.admin}`" class="no-underline">
                {{ a.name }}
                <span v-if="a.admin" class="text-xs font-normal text-muted-foreground">{{ t('login.demoAdmin') }}</span>
              </a>
            </Button>
          </li>
        </ul>
      </template>

      <template v-else-if="accounts">
        <div v-if="route.query.error === 'not_member' || route.query.error === 'no_role'" role="alert" class="mt-4 flex gap-2.5 rounded-lg border border-[#F6C5C1] bg-[#FEF3F2] px-3.5 py-3 text-[#912018]">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <div class="text-sm font-semibold">{{ t(route.query.error === 'no_role' ? 'login.noRoleTitle' : 'login.deniedTitle') }}</div>
            <div class="mt-1 text-[13px] leading-relaxed">
              {{ t('login.deniedAccount') }} <code class="font-mono text-xs">{{ route.query.user }}</code>{{ t(route.query.error === 'no_role' ? 'login.noRoleHint' : 'login.deniedHint') }}
            </div>
          </div>
        </div>
        <p v-else class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ t('login.intro') }}</p>

        <Button as-child class="mt-6 h-11 w-full rounded-lg text-[15px]">
          <a href="/auth/login" class="no-underline hover:text-primary-foreground">
            <MessageSquare class="size-[18px]" aria-hidden="true" />
            {{ t('login.button') }}
          </a>
        </Button>
      </template>
    </div>
  </div>
</template>
