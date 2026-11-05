<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LoaderCircle, Pencil, RotateCw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SegTabs from '@/components/SegTabs.vue'
import { kindKey, stepKey } from '@/components/status'
import { locale, t } from '@/i18n'
import { entries, fetchUsage, members, renameMember, retry, type UsageRow } from '@/api'

const tab = ref('failed')
const queued = ref(new Set<number>())
const editing = ref<string | null>(null)
const draft = ref('')

// Rows stay visible after retry (showing "requeued") until the page is left.
const rows = computed(() => entries.filter((e) => e.failed_step || queued.value.has(e.id)))
const tabs = computed(() => [
  { key: 'failed', label: t('admin.failed'), count: rows.value.length, countClass: 'bg-[#D92D20] text-white' },
  { key: 'members', label: t('admin.members'), count: members.length },
  { key: 'usage', label: t('admin.usage') },
])

const usage = ref<UsageRow[]>()
watch(tab, async (now) => { if (now === 'usage') usage.value = await fetchUsage() }) // fresh each time it's opened
const usagePeriods = ['today', 'week', 'month', 'total'] as const
const usageSum = (key: (typeof usagePeriods)[number]) => usage.value?.reduce((sum, u) => sum + u[key], 0) ?? 0
const count = (n: number) => n.toLocaleString(locale.value)

function doRetry(id: number) {
  queued.value = new Set(queued.value).add(id)
  retry(entries.find((e) => e.id === id)!)
}
async function saveName(id: string) {
  if (draft.value.trim()) await renameMember(id, draft.value.trim())
  editing.value = null
}
const th = 'border-b px-4 py-2.5 font-medium'
const td = 'border-b border-line px-4 align-top'
</script>

<template>
  <main class="mx-auto max-w-[1200px] px-4 pt-5 pb-24 md:px-6 md:pt-7 md:pb-16">
    <h1 class="text-[22px] font-semibold tracking-tight">{{ t('nav.admin') }}</h1>
    <p class="mt-1.5 text-sm text-muted-foreground">{{ t('admin.intro') }}</p>

    <div class="mt-5"><SegTabs v-model="tab" :items="tabs" /></div>

    <div v-if="tab === 'failed'" class="mt-3.5 overflow-x-auto rounded-[10px] border bg-card">
      <table class="w-full min-w-[860px] border-collapse text-[13px]">
        <thead>
          <tr class="bg-field text-left text-muted-foreground">
            <th scope="col" :class="th">{{ t('admin.colTitle') }}</th>
            <th scope="col" :class="th">{{ t('admin.colStep') }}</th>
            <th scope="col" :class="th">{{ t('admin.colError') }}</th>
            <th scope="col" :class="th">{{ t('admin.colTime') }}</th>
            <th scope="col" :class="[th, 'text-right']">{{ t('admin.colAction') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in rows" :key="e.id">
            <td :class="[td, 'py-3']">
              <RouterLink :to="`/entries/${e.id}`" class="font-medium text-foreground no-underline">{{ e.title }}</RouterLink>
              <div class="mt-0.5 text-xs text-faint">{{ t(kindKey(e)) }} · {{ e.created_by }}</div>
            </td>
            <td :class="[td, 'py-3']">
              <span v-if="e.failed_step" class="inline-flex h-[22px] items-center rounded-full border border-[#F6C5C1] bg-[#FDE8E8] px-2 text-xs font-medium whitespace-nowrap text-[#B42318]">{{ t(stepKey(e)) }}</span>
            </td>
            <td :class="[td, 'max-w-[380px] py-3']"><code class="font-mono text-xs leading-normal break-words text-ink-2">{{ e.error }}</code></td>
            <td :class="[td, 'py-3 font-mono text-xs whitespace-nowrap text-muted-foreground']">{{ e.failed_at?.slice(5) }}</td>
            <td :class="[td, 'py-3 text-right whitespace-nowrap']">
              <span v-if="queued.has(e.id)" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#E6EEFF] px-3 text-[13px] text-[#1E4BB8]">
                <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />{{ t('admin.requeued') }}
              </span>
              <Button v-else variant="outline" size="sm" class="bg-card" @click="doRetry(e.id)"><RotateCw aria-hidden="true" />{{ t('common.retry') }}</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="px-6 py-10 text-center text-sm text-muted-foreground">{{ t('admin.noFailed') }}</div>
    </div>

    <template v-else-if="tab === 'usage'">
      <div class="mt-3.5 overflow-x-auto rounded-[10px] border bg-card">
        <table class="w-full min-w-[760px] border-collapse text-[13px]">
          <caption class="sr-only">{{ t('admin.usageCaption') }}</caption>
          <thead>
            <tr class="bg-field text-left text-muted-foreground">
              <th scope="col" :class="th">{{ t('admin.usageMember') }}</th>
              <th v-for="p in usagePeriods" :key="p" scope="col" :class="[th, 'text-right whitespace-nowrap']">{{ t(`admin.usage.${p}`) }}</th>
              <th scope="col" :class="[th, 'text-right whitespace-nowrap']">{{ t('admin.usageCalls') }}</th>
              <th scope="col" :class="[th, 'whitespace-nowrap']">{{ t('admin.usageLast') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in usage" :key="u.member_id">
              <th scope="row" :class="[td, 'py-2.5 text-left font-medium']">
                {{ u.name }}
                <div v-if="u.discord_name && u.discord_name !== u.name" class="font-mono text-xs font-normal text-faint">@{{ u.discord_name }}</div>
              </th>
              <td v-for="p in usagePeriods" :key="p" :class="[td, 'py-2.5 text-right font-mono text-xs']">{{ count(u[p]) }}</td>
              <td :class="[td, 'py-2.5 text-right font-mono text-xs']">{{ count(u.month_calls) }}</td>
              <td :class="[td, 'py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground']">{{ u.last_at.slice(5) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="usage?.length">
            <tr class="bg-field font-medium">
              <th scope="row" class="px-4 py-2.5 text-left">{{ t('admin.usageTotal') }}</th>
              <td v-for="p in usagePeriods" :key="p" class="px-4 py-2.5 text-right font-mono text-xs">{{ count(usageSum(p)) }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-xs">{{ count(usage.reduce((sum, u) => sum + u.month_calls, 0)) }}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div v-if="usage && !usage.length" class="px-6 py-10 text-center text-sm text-muted-foreground">{{ t('admin.usageNone') }}</div>
      </div>
      <p class="mt-2.5 text-xs leading-relaxed text-faint">{{ t('admin.usageNote') }}</p>
    </template>

    <template v-else>
      <div class="mt-3.5 overflow-x-auto rounded-[10px] border bg-card">
        <table class="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr class="bg-field text-left text-muted-foreground">
              <th scope="col" :class="[th, 'w-[34%]']">{{ t('admin.colName') }}</th>
              <th scope="col" :class="th">{{ t('admin.colDiscord') }}</th>
              <th scope="col" :class="th">{{ t('admin.colRole') }}</th>
              <th scope="col" :class="th">{{ t('admin.colJoined') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.discord_id">
              <td :class="[td, 'h-10 py-2']">
                <form v-if="editing === m.discord_id" class="flex items-center gap-1.5" @submit.prevent="saveName(m.discord_id)" @keydown.esc="editing = null">
                  <label :for="'name-' + m.discord_id" class="sr-only">{{ t('admin.colName') }}</label>
                  <Input :id="'name-' + m.discord_id" v-model="draft" autofocus class="h-8 min-w-0 flex-1 bg-card px-2 text-[13px] md:text-[13px]" />
                  <Button type="submit" size="sm" class="h-8 text-xs">{{ t('common.save') }}</Button>
                  <Button type="button" variant="outline" size="sm" class="h-8 bg-card text-xs" @click="editing = null">{{ t('common.cancel') }}</Button>
                </form>
                <div v-else class="flex items-center gap-1.5">
                  <span class="font-medium">{{ m.real_name }}</span>
                  <Button variant="ghost" size="icon-sm" class="size-7 text-faint" :aria-label="t('admin.editName', { name: m.real_name })" @click="editing = m.discord_id; draft = m.real_name">
                    <Pencil class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </td>
              <td :class="[td, 'py-2 font-mono text-xs text-ink-2']">{{ m.discord_name }}</td>
              <td :class="[td, 'py-2']">
                <span v-if="m.is_admin" class="inline-flex h-5 items-center rounded bg-primary px-[7px] text-[11px] font-medium text-primary-foreground">bot-admin</span>
                <span v-else class="text-xs text-muted-foreground">{{ t('role.member') }}</span>
              </td>
              <td :class="[td, 'py-2 font-mono text-xs text-muted-foreground']">{{ m.registered_at }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2.5 text-xs text-faint">{{ t('admin.nameNote') }}</p>
    </template>
  </main>
</template>
