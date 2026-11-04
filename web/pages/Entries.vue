<script setup lang="ts">
import { computed, ref } from 'vue'
import { CircleX, Download, FileText, Plus, Search, Users, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import SegTabs from '@/components/SegTabs.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { kindKey, stepKey, uiStatus } from '@/components/status'
import { t } from '@/i18n'
import { countNI, entries, me, type Entry } from '@/mock'

const q = ref('')
const tab = ref('all')
const showDiscarded = ref(false)
const selected = ref(new Set<number>())

const needle = computed(() => q.value.trim().toLowerCase())
const strings = (x: unknown): string[] =>
  typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []
// ponytail: client-side substring search over mock data; the server does FTS5 (GET /api/entries?q=)
const body = (e: Entry) => [...strings(e.entry), e.source_text ?? '', ...e.source_messages.map((m) => m.content)].join(' ')

const awaitingMe = (e: Entry) => e.status === 'pending_approval' && e.submitted_by !== me.real_name
const FILTERS: Record<string, (e: Entry) => boolean> = {
  mine: awaitingMe,
  draft: (e) => e.status === 'drafting' || e.status === 'draft_ready',
  pending: (e) => e.status === 'pending_approval',
  archived: (e) => e.status === 'approved',
  all: (e) => e.status !== 'discarded' || showDiscarded.value,
}
const count = (k: string) => entries.filter(FILTERS[k]).length
const tabs = computed(() => [
  { key: 'mine', label: t('tab.mine'), count: count('mine'), countClass: 'bg-[#D98A00] text-white' },
  { key: 'draft', label: t('tab.draft'), count: count('draft') },
  { key: 'pending', label: t('tab.pending'), count: count('pending') },
  { key: 'archived', label: t('tab.archived'), count: count('archived') },
  { key: 'all', label: t('tab.all') },
])

/** Splits text into plain / matched parts for highlighting. */
function hl(text: string) {
  const n = needle.value
  if (!n) return [{ t: text, hit: false }]
  const out: { t: string; hit: boolean }[] = []
  const low = text.toLowerCase()
  let i = 0
  for (let j = low.indexOf(n); j >= 0; j = low.indexOf(n, i)) {
    if (j > i) out.push({ t: text.slice(i, j), hit: false })
    out.push({ t: text.slice(j, j + n.length), hit: true })
    i = j + n.length
  }
  if (i < text.length) out.push({ t: text.slice(i), hit: false })
  return out
}

function meta(e: Entry) {
  if (e.status === 'collecting') return t('meta.collecting', { n: e.source_messages.length })
  if (e.failed_step) return t('meta.entered', { name: e.created_by }) + ' · ' + t('meta.failedAt', { step: t(stepKey(e)) })
  if (e.status === 'pending_approval') return t('meta.submitted', { name: e.submitted_by! }) + (awaitingMe(e) ? ' · ' + t('meta.waitingYou') : '')
  if (e.status === 'approved') return t('meta.approved', { name: e.approved_by! })
  if (e.status === 'discarded') return t('meta.discarded', { name: e.discarded_by! })
  if (e.kind === 'session') return t('meta.started', { name: e.created_by }) + (e.channel ? ' · ' + e.channel : '')
  return t('meta.entered', { name: e.created_by })
}

const rows = computed(() =>
  [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((e) => FILTERS[tab.value](e) && (!needle.value || (e.title + ' ' + body(e)).toLowerCase().includes(needle.value)))
    .map((e) => {
      const text = body(e)
      const at = needle.value && !e.title.toLowerCase().includes(needle.value) ? text.toLowerCase().indexOf(needle.value) : -1
      return {
        e,
        status: uiStatus(e),
        href: e.status === 'collecting' ? '' : `/entries/${e.id}`,
        title: hl(e.title),
        snippet: at >= 0 ? hl(text.slice(Math.max(0, at - 36), at + needle.value.length + 60)) : null,
        subs: e.entry?.sections.map((s) => s.subsystem) ?? [],
        people: e.entry?.attendees.length ?? (new Set(e.source_messages.map((m) => m.author)).size || 1),
        ni: e.status === 'approved' ? 0 : countNI(e.entry),
        meta: meta(e),
      }
    }),
)

function toggle(id: number) {
  const s = new Set(selected.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selected.value = s
}
function exportZip() {
  // ponytail: GET /api/export.zip?ids= once the server exists
  toast(t('toast.zipping', { n: selected.value.size }))
  selected.value = new Set()
}
const emptyText = computed(() =>
  needle.value ? t('list.noMatch', { q: q.value.trim() }) : tab.value === 'mine' ? t('list.noneMine') : t('list.noneTab'),
)
</script>

<template>
  <main class="mx-auto max-w-[1200px] px-4 pt-5 pb-24 md:px-6 md:pt-7 md:pb-16">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <h1 class="text-[22px] font-semibold tracking-tight">{{ t('list.title') }}</h1>
      <div class="flex min-w-0 flex-[1_1_280px] flex-wrap justify-end gap-2.5">
        <div class="relative min-w-0 flex-[1_1_260px] md:max-w-[420px]">
          <label for="list-q" class="sr-only">{{ t('list.searchLabel') }}</label>
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            id="list-q" v-model="q" type="search" :placeholder="t('list.searchPlaceholder')"
            class="h-11 w-full rounded-lg border border-input bg-card pr-10 pl-9 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:rounded-md md:pr-3 md:text-sm"
          >
          <button v-if="q" type="button" :aria-label="t('list.clearSearch')" class="absolute top-0 right-0 flex size-11 items-center justify-center text-faint md:hidden" @click="q = ''">
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>
        <Button as-child class="hidden md:inline-flex">
          <RouterLink to="/new" class="no-underline hover:text-primary-foreground"><Plus aria-hidden="true" />{{ t('list.new') }}</RouterLink>
        </Button>
      </div>
    </div>

    <template v-if="entries.length">
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 md:mt-5">
        <SegTabs v-model="tab" :items="tabs" pills />
        <label v-if="tab === 'all'" class="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
          <Checkbox v-model="showDiscarded" />
          {{ t('list.showDiscarded', { n: entries.filter((e) => e.status === 'discarded').length }) }}
        </label>
      </div>

      <div v-if="selected.size" class="mt-3.5 flex flex-wrap items-center gap-3 rounded-lg border border-[#C9D8FF] bg-[#F2F6FF] px-3.5 py-2.5 text-[13px] text-[#1E3F9E]">
        <span>{{ t('list.selected', { n: selected.size }) }}</span>
        <div class="flex-1" />
        <Button variant="ghost" size="sm" class="text-[#1E3F9E] hover:bg-[#E3EBFF]" @click="selected = new Set()">{{ t('list.clearSelection') }}</Button>
        <Button size="sm" @click="exportZip"><Download aria-hidden="true" />{{ t('list.exportZip') }}</Button>
      </div>

      <div v-if="needle" class="mt-3.5 text-[13px] text-muted-foreground">{{ t('list.results', { q: q.trim(), n: rows.length }) }}</div>

      <section :aria-label="t('list.title')" class="mt-3.5 flex flex-col gap-2.5 md:gap-0 md:overflow-hidden md:rounded-[10px] md:border md:bg-card">
        <template v-for="(r, i) in rows" :key="r.e.id">
          <!-- desktop row -->
          <div
            class="hidden flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3.5 md:flex"
            :class="[i && 'border-t border-line', selected.has(r.e.id) && 'bg-[#F4F7FF]', r.status === 'discarded' && 'opacity-70']"
          >
            <div class="flex w-[18px] shrink-0 justify-center">
              <Checkbox v-if="r.status === 'archived'" :model-value="selected.has(r.e.id)" :aria-label="t('list.select', { title: r.e.title })" @update:model-value="toggle(r.e.id)" />
            </div>
            <div class="w-24 shrink-0"><StatusBadge :status="r.status" /></div>
            <div class="min-w-0 flex-[1_1_320px]">
              <div class="flex min-w-0 items-center gap-2">
                <component
                  :is="r.href ? 'RouterLink' : 'span'" :to="r.href || undefined"
                  class="truncate text-sm font-medium no-underline"
                  :class="r.status === 'discarded' ? 'text-faint' : 'text-foreground'"
                ><span v-for="(p, k) in r.title" :key="k" :class="p.hit && 'rounded-xs bg-[#D6E4FF] text-[#123A8C] shadow-[0_0_0_1px_#B7CCFF]'">{{ p.t }}</span></component>
                <CircleX v-if="r.e.failed_step" class="size-[15px] shrink-0 text-destructive" role="img" :aria-label="t('status.failed')" />
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-faint">
                <span class="inline-flex h-5 items-center rounded border bg-field px-1.5 text-[11px] font-medium text-[#4A4A45]">{{ t(kindKey(r.e)) }}</span>
                <span v-for="s in r.subs" :key="s" class="inline-flex h-5 items-center rounded bg-muted px-1.5 text-[11px] text-ink-2">{{ s }}</span>
                <span>{{ r.meta }}</span>
              </div>
              <div v-if="r.snippet" class="mt-1.5 truncate text-xs leading-normal text-muted-foreground">
                …<span v-for="(p, k) in r.snippet" :key="k" :class="p.hit && 'rounded-xs bg-[#D6E4FF] text-[#123A8C] shadow-[0_0_0_1px_#B7CCFF]'">{{ p.t }}</span>…
              </div>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-3.5 text-xs text-muted-foreground">
              <span v-if="r.ni" class="inline-flex h-5 items-center rounded-full border border-ni-line bg-ni px-[7px] text-[11px] font-medium text-ni-ink">{{ t('ni.short', { n: r.ni }) }}</span>
              <span :title="t('list.attendance')" class="inline-flex items-center gap-1"><Users class="size-3.5" aria-hidden="true" />{{ r.people }}</span>
              <span class="w-[82px] text-right font-mono">{{ r.e.date }}</span>
            </div>
          </div>

          <!-- mobile card -->
          <component
            :is="r.href ? 'RouterLink' : 'div'" :to="r.href || undefined"
            class="block rounded-[10px] border bg-card p-3.5 text-foreground no-underline hover:text-foreground md:hidden"
          >
            <div class="flex items-center gap-2">
              <StatusBadge :status="r.status" />
              <span class="inline-flex h-5 items-center rounded border bg-field px-1.5 text-[11px] font-medium text-[#4A4A45]">{{ t(kindKey(r.e)) }}</span>
              <CircleX v-if="r.e.failed_step" class="size-[15px] text-destructive" role="img" :aria-label="t('status.failed')" />
              <div class="flex-1" />
              <span class="font-mono text-xs text-muted-foreground">{{ r.e.date.slice(5) }}</span>
            </div>
            <div class="mt-2 text-[15px] leading-snug font-medium">
              <span v-for="(p, k) in r.title" :key="k" :class="p.hit && 'rounded-xs bg-[#D6E4FF] text-[#123A8C]'">{{ p.t }}</span>
            </div>
            <div v-if="r.snippet" class="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
              …<span v-for="(p, k) in r.snippet" :key="k" :class="p.hit && 'rounded-xs bg-[#D6E4FF] text-[#123A8C]'">{{ p.t }}</span>…
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span v-for="s in r.subs" :key="s" class="inline-flex h-5 items-center rounded bg-muted px-1.5 text-[11px] text-ink-2">{{ s }}</span>
              <span class="inline-flex items-center gap-1"><Users class="size-3.5" aria-hidden="true" />{{ r.people }}</span>
              <span v-if="r.ni" class="inline-flex h-5 items-center rounded-full border border-ni-line bg-ni px-[7px] text-[11px] font-medium text-ni-ink">{{ t('ni.short', { n: r.ni }) }}</span>
            </div>
          </component>
        </template>
        <div v-if="!rows.length" class="rounded-[10px] border bg-card px-6 py-12 text-center text-sm text-muted-foreground md:rounded-none md:border-0">{{ emptyText }}</div>
      </section>
    </template>

    <section v-else class="mt-5 flex flex-col items-center rounded-[10px] border border-dashed border-[#D0D0C9] bg-card px-6 py-[72px] text-center">
      <div aria-hidden="true" class="flex size-14 items-center justify-center rounded-xl bg-muted text-faint"><FileText class="size-[26px]" :stroke-width="1.6" /></div>
      <h2 class="mt-4.5 text-base font-semibold">{{ t('list.emptyTitle') }}</h2>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
        {{ t('list.emptyBefore') }}<code class="rounded border bg-muted px-1.5 py-px font-mono text-[13px] text-foreground">/session start</code>{{ t('list.emptyAfter') }}
      </p>
      <Button as-child variant="outline" class="mt-5.5 bg-card">
        <RouterLink to="/new" class="text-foreground no-underline"><Plus aria-hidden="true" />{{ t('list.new') }}</RouterLink>
      </Button>
    </section>
  </main>
</template>
