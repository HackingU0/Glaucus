<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown, FilePlus, FileText, Settings } from '@lucide/vue'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LOCALES, locale, t } from '@/i18n'
import { me } from '@/mock'
import Avatar from './Avatar.vue'

defineProps<{ ownMobileHeader?: boolean }>()
const route = useRoute()
const active = computed(() => (route.path === '/new' ? 'new' : route.path === '/admin' ? 'admin' : 'list'))
const nav = computed(() => [
  { key: 'list', to: '/', label: t('nav.notes'), icon: FileText },
  { key: 'new', to: '/new', label: t('nav.new'), icon: FilePlus },
  ...(me.is_admin ? [{ key: 'admin', to: '/admin', label: t('nav.admin'), icon: Settings }] : []),
])
</script>

<template>
  <header class="relative z-30 border-b bg-card" :class="ownMobileHeader && 'hidden md:block'">
    <div class="mx-auto flex h-14 max-w-[1440px] items-center gap-5 px-4 md:px-6">
      <RouterLink to="/" class="flex shrink-0 items-center gap-2 text-foreground no-underline hover:text-foreground">
        <span aria-hidden="true" class="flex size-[22px] items-center justify-center rounded-[5px] bg-primary font-mono text-[13px] font-medium text-primary-foreground">v</span>
        <span class="text-[15px] font-semibold tracking-tight">vibedoc</span>
      </RouterLink>
      <nav :aria-label="t('nav.main')" class="hidden items-center gap-0.5 md:flex">
        <RouterLink
          v-for="n in nav" :key="n.key" :to="n.to"
          class="flex h-8 items-center rounded-md px-2.5 text-sm no-underline"
          :class="active === n.key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'"
        >{{ n.label }}</RouterLink>
      </nav>
      <div class="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger :aria-label="t('nav.account')" class="flex h-9 cursor-pointer items-center gap-1.5 rounded-full pr-1.5 pl-1 text-muted-foreground">
          <Avatar :name="me.real_name" />
          <ChevronDown class="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuLabel class="py-2">
            <div class="text-sm font-semibold">{{ me.real_name }}</div>
            <div class="mt-0.5 font-mono text-xs font-normal text-faint">@{{ me.discord_name }} · {{ me.is_admin ? 'bot-admin' : t('role.member') }}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-xs font-normal text-faint">{{ t('common.language') }}</DropdownMenuLabel>
          <DropdownMenuRadioGroup v-model="locale">
            <DropdownMenuRadioItem v-for="(name, code) in LOCALES" :key="code" :value="code">{{ name }}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem as-child>
            <RouterLink to="/login" class="no-underline">{{ t('nav.logout') }}</RouterLink>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>

  <nav
    v-if="!ownMobileHeader"
    :aria-label="t('nav.main')"
    class="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    <RouterLink
      v-for="n in nav" :key="n.key" :to="n.to"
      class="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] no-underline"
      :class="active === n.key ? 'font-semibold text-foreground' : 'text-muted-foreground'"
    >
      <component :is="n.icon" class="size-5" aria-hidden="true" />
      {{ n.label }}
    </RouterLink>
  </nav>
</template>
