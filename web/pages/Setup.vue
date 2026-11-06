<script setup lang="ts">
// First run (design.md §9.1). The form only talks to /api/setup, with the token the server printed to its logs.
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Check, TriangleAlert, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import LangSwitch from '@/components/LangSwitch.vue'
import { setupState } from '@/api'
import { t } from '@/i18n'

interface Named { id: string; name: string }
interface DiscordCheck {
  ok: boolean; error?: string; app_name: string; secret_ok: boolean; message_content: boolean; redirect_uri: string; redirect_ok: boolean; invite_url: string
  guilds: Named[]; guild: { id: string; roles: Named[]; channels: Named[]; missing_permissions: string[] } | null
}
interface MemberCheck { id: string; username: string; name: string; allowed: boolean; admin: boolean; roles: string[] }
type SecretState = { set: boolean; env: boolean }

const route = useRoute()
const token = ref(String(route.query.token ?? ''))
const unlocked = ref(false)
const tokenWrong = ref(false)
const secrets = ref<Record<'llm_key' | 'bot_token' | 'client_secret', SecretState>>()
const form = reactive({
  site_url: location.origin,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  llm: { base_url: '', model: '', key: '' },
  discord: { bot_token: '', client_secret: '', guild_id: '', admin_role_id: '', allowed_role_ids: [] as string[], log_channel_id: '' },
})

const llm = ref<{ ok: boolean; error?: string }>()
const discord = ref<DiscordCheck>()
const query = ref('')
const members = ref<MemberCheck[]>()
const busy = ref('')
const errors = ref<string[]>([])
const done = ref(false)
watch(() => [form.discord.allowed_role_ids, form.discord.admin_role_id], () => { members.value = undefined }) // those answers were for other roles

const call = (path: string, body?: unknown) => fetch(`/api/setup${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'x-setup-token': token.value, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})

async function unlock() {
  const r = await call('/state')
  tokenWrong.value = !r.ok
  if (!r.ok) return
  const s = await r.json()
  secrets.value = s.secrets
  if (s.site_url) form.site_url = s.site_url
  if (s.timezone !== 'UTC') form.timezone = s.timezone
  form.llm = { ...form.llm, base_url: s.llm.base_url, model: s.llm.model }
  Object.assign(form.discord, { guild_id: s.discord.guild_id, admin_role_id: s.discord.admin_role_id, allowed_role_ids: s.discord.allowed_role_ids, log_channel_id: s.discord.log_channel_id })
  unlocked.value = true
}
if (token.value) unlock()

async function run(what: string, fn: () => Promise<void>) {
  busy.value = what
  try {
    await fn()
  } finally {
    busy.value = ''
  }
}
const testLlm = () => run('llm', async () => { llm.value = await (await call('/test/llm', form)).json() })
const testDiscord = () => run('discord', async () => {
  discord.value = await (await call('/test/discord', form)).json()
  if (discord.value?.guild) form.discord.guild_id = discord.value.guild.id
  members.value = undefined
})
const testMember = () => run('member', async () => {
  const r = await call('/test/member', { ...form, query: query.value })
  members.value = r.ok ? await r.json() : []
})
const finish = () => run('finish', async () => {
  const r = await call('', form)
  if (r.ok) {
    setupState.needed = false
    done.value = true
    return
  }
  errors.value = (await r.json()).errors ?? [t('setup.tokenWrong')]
})

const checks = computed(() => {
  const d = discord.value
  if (!d?.ok) return []
  return [
    { ok: true, text: t('setup.checkBot', { name: d.app_name }) },
    { ok: d.secret_ok, text: t('setup.checkSecret') },
    { ok: d.message_content, text: t('setup.checkIntent') },
    { ok: d.redirect_ok, text: t('setup.checkRedirect', { uri: d.redirect_uri }) },
    ...(d.guild ? [{
      ok: !d.guild.missing_permissions.length,
      text: d.guild.missing_permissions.length ? t('setup.missingPerms', { names: d.guild.missing_permissions.join(', ') }) : t('setup.checkPerms'),
    }] : []),
  ]
})
const notLocal = location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)
const secretHint = (s?: SecretState) => (s?.env ? t('setup.fromEnv') : s?.set ? t('setup.keepSecret') : '')
const canCheckMember = computed(() => !!discord.value?.guild && (form.discord.allowed_role_ids.length > 0 || !!form.discord.admin_role_id))
const canFinish = computed(() => !!discord.value?.guild && form.discord.allowed_role_ids.length > 0 && !!form.discord.admin_role_id)

const section = 'rounded-[10px] border bg-card p-5'
const label = 'mt-3.5 block text-sm font-medium'
const hint = 'mt-1 text-xs leading-relaxed text-faint'
const select = 'mt-1.5 h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm'
</script>

<template>
  <div class="relative min-h-dvh bg-background bg-[linear-gradient(#ECECE7_1px,transparent_1px),linear-gradient(90deg,#ECECE7_1px,transparent_1px)] bg-size-[24px_24px] px-4 py-10">
    <div class="absolute top-4 right-4"><LangSwitch /></div>
    <main class="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <div class="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" class="size-[30px]">
        <h1 class="text-xl font-semibold tracking-tight">{{ t('setup.title') }}</h1>
      </div>

      <section v-if="done" :class="section">
        <h2 class="font-semibold">{{ t('setup.doneTitle') }}</h2>
        <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ t('setup.doneBody') }}</p>
        <Button as-child class="mt-4 h-10 rounded-lg"><a href="/auth/login" class="no-underline hover:text-primary-foreground">{{ t('login.button') }}</a></Button>
      </section>

      <form v-else-if="!unlocked" :class="section" @submit.prevent="unlock">
        <p class="text-sm leading-relaxed text-muted-foreground">{{ t('setup.tokenIntro') }}</p>
        <label for="setup-token" :class="label">{{ t('setup.tokenLabel') }}</label>
        <Input id="setup-token" v-model="token" autocomplete="off" class="mt-1.5 font-mono" />
        <p v-if="tokenWrong" role="alert" class="mt-2 text-sm text-destructive">{{ t('setup.tokenWrong') }}</p>
        <Button type="submit" :disabled="!token.trim()" class="mt-4">{{ t('setup.tokenButton') }}</Button>
      </form>

      <template v-else>
        <div v-if="notLocal" role="alert" class="flex gap-2.5 rounded-lg border border-[#F6C5C1] bg-[#FEF3F2] px-3.5 py-3 text-[13px] leading-relaxed text-[#912018]">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ t('setup.httpWarning') }}
        </div>

        <section :class="section">
          <h2 class="font-semibold">{{ t('setup.siteTitle') }}</h2>
          <label for="site-url" :class="label">{{ t('setup.siteUrl') }}</label>
          <Input id="site-url" v-model="form.site_url" type="url" class="mt-1.5" />
          <p :class="hint">{{ t('setup.siteHint') }}</p>
          <label for="timezone" :class="label">{{ t('setup.timezone') }}</label>
          <Input id="timezone" v-model="form.timezone" class="mt-1.5" />
        </section>

        <section :class="section">
          <h2 class="font-semibold">{{ t('setup.aiTitle') }}</h2>
          <label for="llm-url" :class="label">{{ t('setup.baseUrl') }}</label>
          <Input id="llm-url" v-model="form.llm.base_url" type="url" class="mt-1.5" />
          <label for="llm-model" :class="label">{{ t('setup.model') }}</label>
          <Input id="llm-model" v-model="form.llm.model" class="mt-1.5" />
          <label for="llm-key" :class="label">{{ t('setup.apiKey') }}</label>
          <Input id="llm-key" v-model="form.llm.key" type="password" autocomplete="off" :disabled="secrets?.llm_key.env" :placeholder="secretHint(secrets?.llm_key)" class="mt-1.5" />
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" :disabled="!!busy" @click="testLlm">{{ busy === 'llm' ? t('setup.testing') : t('setup.testAi') }}</Button>
            <span v-if="llm" role="status" class="flex min-w-0 items-center gap-1.5 text-sm" :class="llm.ok ? 'text-[#1D6B3A]' : 'text-destructive'">
              <component :is="llm.ok ? Check : X" class="size-4 shrink-0" aria-hidden="true" />{{ llm.ok ? t('setup.aiOk') : llm.error }}
            </span>
          </div>
        </section>

        <section :class="section">
          <h2 class="font-semibold">{{ t('setup.discordTitle') }}</h2>
          <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
            {{ t('setup.discordIntro') }} <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">{{ t('setup.portal') }}</a>
          </p>
          <label for="bot-token" :class="label">{{ t('setup.botToken') }}</label>
          <Input id="bot-token" v-model="form.discord.bot_token" type="password" autocomplete="off" :disabled="secrets?.bot_token.env" :placeholder="secretHint(secrets?.bot_token)" class="mt-1.5" />
          <label for="client-secret" :class="label">{{ t('setup.clientSecret') }}</label>
          <Input id="client-secret" v-model="form.discord.client_secret" type="password" autocomplete="off" :disabled="secrets?.client_secret.env" :placeholder="secretHint(secrets?.client_secret)" class="mt-1.5" />
          <Button type="button" variant="outline" :disabled="!!busy" class="mt-4" @click="testDiscord">{{ busy === 'discord' ? t('setup.testing') : t('setup.testDiscord') }}</Button>

          <p v-if="discord && !discord.ok" role="alert" class="mt-3 flex items-center gap-1.5 text-sm text-destructive"><X class="size-4 shrink-0" aria-hidden="true" />{{ discord.error }}</p>
          <ul v-if="checks.length" class="mt-3 flex flex-col gap-1.5 text-sm">
            <li v-for="c in checks" :key="c.text" class="flex gap-1.5 break-words" :class="c.ok ? 'text-[#1D6B3A]' : 'text-destructive'">
              <component :is="c.ok ? Check : X" class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span class="min-w-0">{{ c.text }}</span>
            </li>
          </ul>

          <template v-if="discord?.ok">
            <p v-if="!discord.guilds.length" class="mt-3 text-sm">{{ t('setup.inviteHint') }} <a :href="discord.invite_url" target="_blank" rel="noreferrer">{{ t('setup.invite') }}</a></p>
            <template v-else>
              <label for="guild" :class="label">{{ t('setup.server') }}</label>
              <select id="guild" v-model="form.discord.guild_id" :class="select" @change="testDiscord">
                <option value="" disabled>{{ t('setup.pick') }}</option>
                <option v-for="g in discord.guilds" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </template>
          </template>
        </section>

        <section v-if="discord?.guild" :class="section">
          <h2 class="font-semibold">{{ t('setup.accessTitle') }}</h2>
          <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{{ t('setup.accessIntro') }}</p>
          <fieldset class="mt-3.5">
            <legend class="text-sm font-medium">{{ t('setup.allowedRoles') }}</legend>
            <p v-if="!discord.guild.roles.length" :class="hint">{{ t('setup.noRoles') }}</p>
            <label v-for="r in discord.guild.roles" :key="r.id" class="mt-1.5 flex min-h-8 cursor-pointer items-center gap-2 text-sm">
              <input v-model="form.discord.allowed_role_ids" type="checkbox" :value="r.id" class="size-4 accent-primary">{{ r.name }}
            </label>
          </fieldset>
          <label for="admin-role" :class="label">{{ t('setup.adminRole') }}</label>
          <select id="admin-role" v-model="form.discord.admin_role_id" :class="select">
            <option value="" disabled>{{ t('setup.pick') }}</option>
            <option v-for="r in discord.guild.roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <p :class="hint">{{ t('setup.adminHint') }}</p>
          <label for="log-channel" :class="label">{{ t('setup.logChannel') }}</label>
          <select id="log-channel" v-model="form.discord.log_channel_id" :class="select">
            <option value="">{{ t('setup.logNone') }}</option>
            <option v-for="c in discord.guild.channels" :key="c.id" :value="c.id">#{{ c.name }}</option>
          </select>

          <form class="mt-5 border-t border-line pt-4" @submit.prevent="testMember">
            <label for="member-query" class="block text-sm font-medium">{{ t('setup.memberTitle') }}</label>
            <p :class="hint">{{ t('setup.memberIntro') }}</p>
            <div class="mt-2 flex gap-2">
              <Input id="member-query" v-model="query" autocomplete="off" :placeholder="t('setup.memberPlaceholder')" />
              <Button type="submit" variant="outline" :disabled="!!busy || !query.trim() || !canCheckMember">{{ busy === 'member' ? t('setup.testing') : t('setup.memberButton') }}</Button>
            </div>
            <p v-if="members && !members.length" role="status" class="mt-2.5 text-sm text-muted-foreground">{{ t('setup.memberNone') }}</p>
            <ul v-else-if="members" class="mt-2.5 flex flex-col gap-2" aria-live="polite">
              <li v-for="m in members" :key="m.id" class="flex gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <component :is="m.allowed ? Check : X" class="mt-0.5 size-4 shrink-0" :class="m.allowed ? 'text-[#1D6B3A]' : 'text-destructive'" aria-hidden="true" />
                <div class="min-w-0">
                  <div class="font-medium">{{ m.name }} <span class="font-mono text-xs font-normal text-faint">@{{ m.username }}</span></div>
                  <div :class="m.allowed ? 'text-[#1D6B3A]' : 'text-destructive'">{{ m.admin ? t('setup.memberAdmin') : m.allowed ? t('setup.memberAllowed') : t('setup.memberDenied') }}</div>
                  <div class="text-xs text-faint">{{ t('setup.memberRoles', { roles: m.roles.join(', ') || '—' }) }}</div>
                </div>
              </li>
            </ul>
          </form>
        </section>

        <section v-if="discord?.guild" class="flex flex-col gap-3">
          <ul v-if="errors.length" role="alert" class="flex flex-col gap-1 rounded-lg border border-[#F6C5C1] bg-[#FEF3F2] px-3.5 py-3 text-[13px] leading-relaxed break-words text-[#912018]">
            <li v-for="e in errors" :key="e">{{ e }}</li>
          </ul>
          <div class="flex flex-wrap items-center gap-3">
            <Button type="button" :disabled="!!busy || !canFinish" class="h-10" @click="finish">{{ busy === 'finish' ? t('setup.finishing') : t('setup.finish') }}</Button>
            <span class="text-xs text-faint">{{ t('setup.finishHint') }}</span>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
