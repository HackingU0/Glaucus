<script setup lang="ts">
// One page for every entry state (ui-brief.md §5): generating, draft, pending, archived, discarded,
// failed (overlay). Desktop: source | note columns. Mobile: own header + Note / Source tabs.
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ArrowLeft, ArrowUp, Bell, Check, ChevronDown, CircleCheck, Download, FileX, History, LoaderCircle,
  MoreHorizontal, Pencil, RefreshCw, RotateCw, Trash2, TriangleAlert, Undo2,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import Avatar from '@/components/Avatar.vue'
import EntryForm from '@/components/EntryForm.vue'
import NiJump from '@/components/NiJump.vue'
import ReadingView from '@/components/ReadingView.vue'
import SegTabs from '@/components/SegTabs.vue'
import SourcePanel from '@/components/SourcePanel.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { STATUS, kindKey, statusKey, stepKey, uiStatus } from '@/components/status'
import { t, type Key } from '@/i18n'
import {
  approve, countNI, discard, fetchEntry, getEntry, me, regenerate, reopen, retry, returnEntry, revise, save, submit,
  type NotebookEntry, type Revision,
} from '@/api'

const route = useRoute()
const e = computed(() => getEntry(Number(route.params.id)))

// ---- local working copy -------------------------------------------------------------
const draft = ref<NotebookEntry | null>(null)
const ai = reactive(new Set<unknown>())
let baseVersion = 0
function load() {
  const x = e.value
  draft.value = x?.entry ? JSON.parse(JSON.stringify(x.entry)) : null
  baseVersion = x?.version ?? 0
  ai.clear()
  for (const k of x?.ai_untouched ?? []) ai.add(k.startsWith('section:') ? draft.value?.sections[Number(k.slice(8))] : k)
}
watch(() => [e.value?.status, e.value?.version], load, { immediate: true })
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== JSON.stringify(e.value?.entry))
const aiList = () => [...ai].map((k) => (typeof k === 'string' ? k : 'section:' + draft.value!.sections.indexOf(k as never)))

// ---- mode ---------------------------------------------------------------------------
const editingArchived = ref(false)
const mode = computed(() => {
  const x = e.value!
  if (x.status === 'collecting') return 'collecting'
  if (x.status === 'drafting') return x.failed_step ? 'failedEmpty' : 'generating'
  if (x.status === 'draft_ready') return 'draft'
  if (x.status === 'pending_approval') return 'pending'
  if (x.status === 'approved') return editingArchived.value ? 'editArchived' : 'archived'
  return 'discarded'
})
const editing = computed(() => mode.value === 'draft' || mode.value === 'editArchived')
const status = computed(() => uiStatus(e.value!))
const niCount = computed(() => (editing.value ? countNI(draft.value) : mode.value === 'pending' ? countNI(e.value!.entry) : 0))
const isSubmitter = computed(() => e.value?.submitted_by === me.real_name)

const sourceOpen = ref(e.value?.status !== 'discarded')
const mobileTab = ref('note')
const mobileTabs = computed(() => [{ key: 'note', label: t('detail.tabNote') }, { key: 'source', label: t('source.title') }])

// ---- actions ------------------------------------------------------------------------
type Dlg = 'regen' | 'discard' | 'reject' | 'editPending' | 'editArchived' | 'conflict' | null
const dlg = ref<Dlg>(null)
const reason = ref('')
const reasonErr = ref(false)
const aiText = ref('')

async function doSave(quiet = false) {
  const x = e.value!
  if (!(await save(x, draft.value!, baseVersion, aiList()))) { dlg.value = 'conflict'; return false }
  editingArchived.value = false
  if (!quiet) toast(t('toast.saved'))
  return true
}
async function doSubmit() {
  if (dirty.value && !(await doSave(true))) return
  await submit(e.value!)
}
function doReject() {
  if (!reason.value.trim()) { reasonErr.value = true; return }
  returnEntry(e.value!, reason.value.trim())
  dlg.value = null
  reason.value = ''
}
function sendToAI() {
  if (!aiText.value.trim()) return
  revise(e.value!, aiText.value.trim())
  aiText.value = ''
}
function addImage(attachmentId: number, i: number) {
  const s = draft.value!.sections[i]
  if (!s.images.some((im) => im.attachment_id === attachmentId)) s.images.push({ attachment_id: attachmentId, caption: '' })
  ai.delete(s)
}
function exportMd() {
  location.href = `/api/entries/${e.value!.id}/export.md`
  const slug = e.value!.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  toast(t('toast.exported', { file: `${e.value!.date}-${slug}.md` }))
}

// ---- reading view bits --------------------------------------------------------------
const short = (s?: string) => s?.slice(5) ?? ''
const sigs = computed(() => {
  const x = e.value!
  const out: { role: string; who: string; when: string; muted?: boolean }[] = [{ role: 'Drafted by', who: 'AI (vibedoc)', when: x.drafted_at ?? '—' }]
  if (x.status === 'discarded') return [...out, { role: 'Discarded by', who: x.discarded_by!, when: x.discarded_at! }]
  out.push({ role: 'Submitted by', who: x.submitted_by ?? '—', when: x.submitted_at ?? '—', muted: !x.submitted_by })
  out.push(x.approved_by ? { role: 'Approved by', who: x.approved_by, when: x.approved_at! } : { role: 'Approved by', who: 'Pending', when: '—', muted: true })
  return out
})
const histOpen = ref(true)
const viewing = ref<Revision | null>(null)
const revKey = (w: string) => ('rev.' + w) as Key
</script>

<template>
  <main v-if="!e" class="mx-auto max-w-[1200px] px-4 py-16 text-center text-muted-foreground">
    {{ t('detail.notFound') }} <RouterLink to="/">{{ t('detail.backToList') }}</RouterLink>
  </main>

  <div v-else>
    <!-- mobile header -->
    <header class="sticky top-0 z-20 border-b border-line bg-card md:hidden">
      <div class="flex h-14 items-center gap-1 pr-2 pl-1">
        <RouterLink to="/" :aria-label="t('detail.backToList')" class="flex size-11 items-center justify-center text-foreground"><ArrowLeft class="size-5" aria-hidden="true" /></RouterLink>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[15px] font-semibold">{{ e.title }}</div>
          <div class="mt-px flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span class="size-1.5 shrink-0 rounded-full" :class="STATUS[status].dot" />
            {{ t(statusKey(status)) }} ·
            <template v-if="mode === 'pending'">{{ t('meta.submitted', { name: e.submitted_by! }) }} · {{ short(e.submitted_at) }}</template>
            <template v-else>{{ t(kindKey(e)) }} · {{ short(e.date) }}</template>
            <span v-if="dirty" class="text-[#1E4BB8]">· {{ t('detail.unsaved') }}</span>
          </div>
        </div>
        <template v-if="mode === 'draft'">
          <Button variant="outline" class="h-11 rounded-lg bg-card px-3" :class="dirty && 'border-link bg-ai font-semibold text-ai-ink'" @click="doSave()">{{ t('common.save') }}</Button>
          <Button class="h-11 rounded-lg px-3" @click="doSubmit">{{ t('detail.submitShort') }}</Button>
        </template>
        <Button v-else-if="mode === 'pending'" variant="outline" class="h-11 rounded-lg bg-card px-3" @click="dlg = 'editPending'">{{ t('common.edit') }}</Button>
      </div>
      <div v-if="e.entry || draft" class="flex flex-col gap-2 border-t border-line px-3 py-2">
        <NiJump v-if="niCount && mobileTab === 'note'" :count="niCount" block />
        <button v-else-if="niCount" type="button" class="flex h-11 items-center gap-2 rounded-lg border border-ni-line bg-ni px-3 text-sm font-semibold text-ni-ink" @click="mobileTab = 'note'">
          <TriangleAlert class="size-4" aria-hidden="true" />{{ t('ni.count', { n: niCount }) }}<span class="flex-1" /><span class="text-[13px] font-normal">{{ t('ni.goFill') }}</span>
        </button>
        <SegTabs v-model="mobileTab" :items="mobileTabs" class="w-full! [&>button]:h-[38px] [&>button]:flex-1 [&>button]:justify-center [&>button]:text-sm" />
      </div>
    </header>

    <main class="mx-auto max-w-[1440px] px-3 pt-4 pb-24 md:px-6 md:pt-5 md:pb-20">
      <!-- desktop header -->
      <nav :aria-label="t('common.breadcrumb')" class="hidden gap-1.5 text-[13px] text-faint md:flex">
        <RouterLink to="/" class="text-muted-foreground no-underline">{{ t('list.title') }}</RouterLink><span aria-hidden="true">/</span><span class="truncate">{{ e.title }}</span>
      </nav>
      <div class="mt-3 hidden flex-wrap items-start gap-4 border-b pb-4.5 md:flex">
        <div class="min-w-0 flex-[1_1_520px]">
          <h1 class="text-[22px] leading-tight font-semibold tracking-tight" :class="mode === 'discarded' && 'text-faint line-through decoration-[#B5B5AE]'">{{ e.title }}</h1>
          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusBadge :status="status" />
            <span class="inline-flex h-[22px] items-center rounded border bg-card px-[7px] text-xs font-medium text-[#4A4A45]">{{ t(kindKey(e)) }}</span>
            <span class="font-mono text-xs text-muted-foreground">{{ e.date }}</span>
            <NiJump v-if="niCount" :count="niCount" />
            <span v-else-if="editing" class="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#BFE3CB] bg-[#E3F4E8] px-2.5 text-xs text-[#1D6B3A]"><Check class="size-3.5" aria-hidden="true" />{{ t('ni.none') }}</span>
            <span v-if="mode === 'archived'" class="inline-flex h-[22px] items-center rounded border border-dashed border-input px-[7px] text-xs text-muted-foreground">{{ t('detail.readOnly') }}</span>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span v-if="e.drafted_at">{{ t('detail.aiDrafted') }} · <span class="font-mono text-xs">{{ short(e.drafted_at) }}</span></span>
            <span v-else>{{ t('meta.entered', { name: e.created_by }) }} · <span class="font-mono text-xs">{{ short(e.created_at) }}</span></span>
            <template v-if="mode === 'discarded'">
              <span>{{ t('meta.discarded', { name: e.discarded_by! }) }} · <span class="font-mono text-xs">{{ short(e.discarded_at) }}</span></span>
            </template>
            <template v-else>
              <span v-if="e.submitted_by"><strong class="font-semibold text-foreground">{{ e.submitted_by }}</strong> {{ t('detail.submittedVerb') }} · <span class="font-mono text-xs">{{ short(e.submitted_at) }}</span></span>
              <span v-else>{{ t('detail.submittedNone') }}</span>
              <span v-if="e.approved_by" class="inline-flex items-center gap-1 text-[#1D6B3A]"><CircleCheck class="size-3.5" aria-hidden="true" /><strong class="font-semibold">{{ e.approved_by }}</strong> {{ t('detail.approvedVerb') }} · <span class="font-mono text-xs">{{ short(e.approved_at) }}</span></span>
              <span v-else>{{ mode === 'pending' ? t('detail.approvalWaiting') : t('detail.approvalNone') }}</span>
            </template>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <template v-if="mode === 'generating' || mode === 'collecting'">
            <Button variant="outline" disabled class="bg-card">{{ t('common.save') }}</Button>
            <Button disabled>{{ t('detail.submit') }}</Button>
            <Button variant="outline" size="icon" disabled class="bg-card" :aria-label="t('detail.more')"><MoreHorizontal aria-hidden="true" /></Button>
          </template>
          <template v-else-if="mode === 'draft'">
            <span v-if="dirty" class="inline-flex items-center gap-1.5 text-xs text-[#1E4BB8]"><span class="size-1.5 rounded-full bg-[#2F6BFF]" />{{ t('detail.unsaved') }}</span>
            <Button variant="outline" class="bg-card" :class="dirty && 'border-link bg-ai font-semibold text-ai-ink hover:bg-ai'" @click="doSave()">{{ t('common.save') }}</Button>
            <Button @click="doSubmit">{{ t('detail.submit') }}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="icon" class="bg-card" :aria-label="t('detail.more')"><MoreHorizontal aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem @select="dlg = 'regen'"><RefreshCw aria-hidden="true" />{{ t('detail.regenerate') }}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" @select="dlg = 'discard'"><Trash2 aria-hidden="true" />{{ t('detail.discard') }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
          <template v-else-if="mode === 'failedEmpty'">
            <Button disabled>{{ t('detail.submit') }}</Button>
            <Button variant="outline" class="bg-card text-[#B42318]" @click="dlg = 'discard'">{{ t('detail.discard') }}</Button>
          </template>
          <template v-else-if="mode === 'pending'">
            <span v-if="isSubmitter" class="text-[13px] text-muted-foreground">{{ t('detail.waitingOthers') }}</span>
            <Button variant="outline" class="bg-card" @click="dlg = 'editPending'"><Pencil aria-hidden="true" />{{ t('common.edit') }}</Button>
            <template v-if="!isSubmitter">
              <Button variant="outline" class="bg-card" @click="dlg = 'reject'; reasonErr = false"><Undo2 aria-hidden="true" />{{ t('detail.return') }}</Button>
              <Button class="bg-[#1D7A3F] hover:bg-[#186634]" @click="approve(e)"><Check aria-hidden="true" />{{ t('detail.approve') }}</Button>
            </template>
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <span tabindex="0"><Button disabled><Check aria-hidden="true" />{{ t('detail.approve') }}</Button></span>
              </TooltipTrigger>
              <TooltipContent>{{ t('detail.cantApproveOwn') }}</TooltipContent>
            </Tooltip>
          </template>
          <template v-else-if="mode === 'archived'">
            <Button variant="outline" class="bg-card" @click="exportMd"><Download aria-hidden="true" />{{ t('detail.exportMd') }}</Button>
            <Button v-if="me.is_admin" variant="outline" class="bg-card" @click="dlg = 'editArchived'">
              <Pencil aria-hidden="true" />{{ t('common.edit') }}<span class="rounded-[3px] bg-primary px-1 font-mono text-[10px] text-primary-foreground">admin</span>
            </Button>
          </template>
          <template v-else-if="mode === 'editArchived'">
            <Button variant="outline" class="bg-card" @click="editingArchived = false; load()">{{ t('common.cancel') }}</Button>
            <Button :disabled="!dirty" @click="doSave()">{{ t('common.save') }}</Button>
          </template>
          <Button v-else as-child variant="outline" class="bg-card">
            <RouterLink to="/" class="text-foreground no-underline"><ArrowLeft aria-hidden="true" />{{ t('detail.backToList') }}</RouterLink>
          </Button>
        </div>
      </div>

      <!-- alerts -->
      <div v-if="mode === 'draft' && e.returned" role="alert" class="mt-4 flex gap-2.5 rounded-lg border border-[#F5D9A0] bg-[#FDF6E7] px-4 py-3 text-[#7A4300]">
        <Undo2 class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <div class="text-sm font-semibold">{{ t('detail.returnedBy', { name: e.returned.by }) }} · <span class="font-mono text-xs font-normal">{{ short(e.returned.at) }}</span></div>
          <div class="mt-1 text-sm leading-relaxed">“{{ e.returned.reason }}”</div>
        </div>
      </div>
      <div v-if="e.failed_step" role="alert" class="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#F6C5C1] bg-[#FEF3F2] px-4 py-3 text-[#912018]">
        <TriangleAlert class="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold">{{ t('detail.failedTitle', { step: t(stepKey(e)) }) }}</div>
          <code class="mt-0.5 block font-mono text-xs break-words">{{ e.error }} · {{ short(e.failed_at) }}</code>
        </div>
        <Button v-if="me.is_admin" size="sm" class="bg-[#B42318] hover:bg-[#912018]" @click="retry(e)"><RotateCw aria-hidden="true" />{{ t('common.retry') }}</Button>
        <span v-else class="inline-flex items-center gap-1.5 text-[13px]"><Bell class="size-3.5" aria-hidden="true" />{{ t('detail.adminNotified') }}</span>
      </div>
      <div v-if="mode === 'discarded'" role="note" class="mt-4 flex items-center gap-2.5 rounded-lg border border-dashed border-[#C9C9C2] bg-[#EFEFEC] px-4 py-3 text-sm text-ink-2">
        <Trash2 class="size-4 shrink-0" aria-hidden="true" />
        <span><strong class="font-semibold">{{ t('detail.discardedTitle') }}</strong> {{ t('detail.discardedBody') }}</span>
      </div>

      <!-- body -->
      <div class="mt-4 flex flex-wrap items-start gap-6 md:mt-5">
        <aside
          v-if="sourceOpen" :aria-label="t('source.title')" class="min-w-0 flex-[4_1_360px]"
          :class="[mobileTab === 'source' ? 'block' : 'hidden md:block', mode === 'discarded' && 'opacity-75 grayscale']"
        >
          <SourcePanel :entry="e" :sections="editing ? draft!.sections : undefined" collapsible @collapse="sourceOpen = false" @add="addImage" />
        </aside>
        <template v-else>
          <button
            type="button" :aria-label="t('source.expand')"
            class="hidden h-40 flex-[0_0_44px] cursor-pointer items-center justify-center rounded-[10px] border bg-card text-xs text-[#4A4A45] [writing-mode:vertical-rl] md:flex"
            @click="sourceOpen = true"
          >{{ t('source.title') }}</button>
          <div v-if="mobileTab === 'source'" class="w-full md:hidden">
            <SourcePanel :entry="e" :sections="editing ? draft!.sections : undefined" @add="addImage" />
          </div>
        </template>

        <div class="min-w-0 flex-[6_1_560px]" :class="[mobileTab === 'note' ? 'block' : 'hidden md:block', !editing && 'max-w-[900px]']">
          <!-- generating -->
          <template v-if="mode === 'generating'">
            <div role="status" class="flex gap-3 rounded-[10px] border border-[#C9D8FF] bg-[#F2F6FF] px-4 py-3.5 text-[#1E3F9E]">
              <LoaderCircle class="mt-0.5 size-[18px] shrink-0 animate-spin" aria-hidden="true" />
              <div>
                <div class="text-sm font-semibold">{{ t('gen.title') }}</div>
                <div class="mt-1 text-[13px] leading-relaxed">
                  {{ e.revising ? t('gen.revising', { text: e.revising }) : t('gen.fresh', { n: e.source_messages.length || 1, m: e.attachments.length }) }}
                </div>
              </div>
            </div>
            <div v-if="e.revising && e.entry" class="mt-4">
              <div class="mb-2 text-xs font-medium text-muted-foreground">{{ t('gen.oldVersion') }}</div>
              <div aria-hidden="true" class="pointer-events-none opacity-45 select-none">
                <ReadingView :note="e.entry" :attachments="e.attachments" :entry-no="e.date" :sigs="sigs" />
              </div>
            </div>
            <div v-else aria-hidden="true" class="mt-4 flex flex-col gap-6 rounded-[10px] border bg-card p-5">
              <div class="flex flex-col gap-2"><Skeleton class="h-3 w-16" /><Skeleton class="h-9 w-full" /></div>
              <div class="flex gap-2.5"><Skeleton class="h-9 flex-[1.4]" /><Skeleton class="h-9 flex-1" /><Skeleton class="h-9 flex-1" /></div>
              <div class="flex gap-2"><Skeleton class="h-[30px] w-24 rounded-full" /><Skeleton class="h-[30px] w-20 rounded-full" /><Skeleton class="h-[30px] w-24 rounded-full" /></div>
              <div class="flex flex-col gap-2"><Skeleton class="h-3 w-24" /><Skeleton class="h-9 w-full" /><Skeleton class="h-9 w-4/5" /></div>
              <div class="flex flex-col gap-3 rounded-[10px] border p-4"><Skeleton class="h-6 w-40" /><Skeleton class="h-20 w-full" /><Skeleton class="h-9 w-full" /><Skeleton class="h-9 w-3/4" /></div>
            </div>
            <div class="sticky bottom-3 mt-4 flex items-center gap-2 rounded-xl border bg-card p-2 opacity-70 shadow-[0_6px_20px_rgba(0,0,0,.06)]">
              <input disabled :aria-label="t('ai.label')" :placeholder="t('ai.disabled')" class="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm">
              <Button size="icon" disabled :aria-label="t('ai.send')"><ArrowUp aria-hidden="true" /></Button>
            </div>
          </template>

          <!-- empty: collecting / failed before a draft existed -->
          <div v-else-if="mode === 'collecting' || mode === 'failedEmpty'" class="flex flex-col items-center rounded-[10px] border border-dashed border-[#D0D0C9] bg-card px-6 py-16 text-center">
            <div aria-hidden="true" class="flex size-12 items-center justify-center rounded-xl bg-muted text-faint"><FileX class="size-6" :stroke-width="1.6" /></div>
            <h2 class="mt-4 text-base font-semibold">{{ t('detail.noDraftTitle') }}</h2>
            <p class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{{ mode === 'collecting' ? t('detail.collectingBody') : t('detail.noDraftBody') }}</p>
          </div>

          <!-- editable -->
          <template v-else-if="editing && draft">
            <EntryForm :note="draft" :ai="ai" :attachments="e.attachments" :drafted-at="e.drafted_at" />
            <form v-if="mode === 'draft'" class="sticky bottom-0 mt-5 bg-linear-to-t from-background from-70% to-transparent pt-4 pb-3" @submit.prevent="sendToAI">
              <div class="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-[0_6px_20px_rgba(0,0,0,.08)]">
                <span aria-hidden="true" class="ai-tag mb-3 ml-1">AI</span>
                <label for="ai-revise" class="sr-only">{{ t('ai.label') }}</label>
                <Textarea
                  id="ai-revise" v-model="aiText" rows="1" :placeholder="t('ai.placeholder')"
                  class="max-h-40 min-h-10 resize-none border-0 bg-transparent py-2.5 shadow-none focus-visible:ring-0"
                  @keydown.enter.exact.prevent="sendToAI"
                />
                <Button type="submit" size="icon" class="size-10 shrink-0" :disabled="!aiText.trim()" :aria-label="t('ai.send')"><ArrowUp aria-hidden="true" /></Button>
              </div>
              <div class="mt-1.5 px-1 text-xs text-faint">{{ dirty ? t('ai.hintDirty') : t('ai.hint') }}</div>
            </form>
          </template>

          <!-- read-only -->
          <template v-else-if="e.entry">
            <div :class="mode === 'discarded' && 'opacity-60 grayscale'">
              <ReadingView :note="e.entry" :attachments="e.attachments" :entry-no="e.date" :sigs="sigs" />
            </div>

            <section v-if="mode === 'archived' && e.revisions.length" class="mt-5 rounded-[10px] border bg-card">
              <button type="button" class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-semibold" :aria-expanded="histOpen" @click="histOpen = !histOpen">
                <History class="size-4" aria-hidden="true" />{{ t('rev.title') }}
                <span class="font-normal text-faint">· {{ t('rev.count', { n: e.revisions.length }) }}</span>
                <span class="flex-1" />
                <ChevronDown class="size-4 text-faint transition-transform" :class="histOpen && 'rotate-180'" aria-hidden="true" />
              </button>
              <template v-if="histOpen">
                <ol class="border-t border-line">
                  <li v-for="(r, i) in e.revisions" :key="r.v" class="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0" :class="viewing === r && 'bg-[#F4F7FF]'">
                    <span class="w-6 font-mono text-xs text-muted-foreground">v{{ r.v }}</span>
                    <Avatar :name="r.by" :size="26" />
                    <div class="min-w-0 flex-1">
                      <div class="text-[13px]"><strong class="font-semibold">{{ r.by }}</strong> {{ t(revKey(r.what)) }}</div>
                      <div class="font-mono text-[11px] text-faint">{{ r.at }}</div>
                    </div>
                    <span v-if="i === 0" class="rounded-full bg-[#E3F4E8] px-2 py-0.5 text-[11px] font-medium text-[#1D6B3A]">{{ t('rev.current') }}</span>
                    <Button v-else variant="outline" size="sm" class="h-7 bg-card text-xs" @click="viewing = viewing === r ? null : r">{{ viewing === r ? t('rev.hide') : t('rev.view') }}</Button>
                  </li>
                </ol>
                <div v-if="viewing" class="border-t border-line bg-field p-4">
                  <div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span class="rounded bg-primary px-1.5 py-0.5 font-mono text-[11px] text-primary-foreground">v{{ viewing.v }} · {{ t('detail.readOnly') }}</span>{{ t('rev.oldNote') }}
                  </div>
                  <ReadingView
                    :note="viewing.entry" :attachments="e.attachments" :entry-no="`${e.date} · v${viewing.v}`"
                    :sigs="[sigs[0], { role: 'Status', who: `Superseded by v${e.revisions[0].v}`, when: '—', muted: true }]"
                  />
                </div>
              </template>
            </section>
          </template>
        </div>
      </div>
    </main>

    <!-- mobile approve bar -->
    <div v-if="mode === 'pending' && mobileTab === 'note'" class="fixed inset-x-0 bottom-0 z-20 border-t bg-card px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden">
      <div v-if="!isSubmitter" class="flex gap-2">
        <Button variant="outline" class="h-11 flex-1 rounded-lg bg-card" @click="dlg = 'reject'; reasonErr = false">{{ t('detail.return') }}</Button>
        <Button class="h-11 flex-[2] rounded-lg bg-[#1D7A3F] hover:bg-[#186634]" @click="approve(e)"><Check aria-hidden="true" />{{ t('detail.approve') }}</Button>
      </div>
      <template v-else>
        <Button disabled class="h-11 w-full rounded-lg">{{ t('detail.approve') }}</Button>
        <div class="mt-1.5 text-center text-xs text-faint">{{ t('detail.cantApproveOwn') }} · {{ t('detail.waitingOthers') }}</div>
      </template>
    </div>

    <!-- dialogs -->
    <AlertDialog :open="dlg === 'regen'" @update:open="dlg = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dlg.regenTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('dlg.regenBody') }} <strong class="text-foreground">{{ t('dlg.regenStrong') }}</strong>{{ t('dlg.regenTail') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="regenerate(e)">{{ t('dlg.regenAction') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="dlg === 'discard'" @update:open="dlg = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dlg.discardTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('dlg.discardBody') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive hover:bg-destructive/90" @click="discard(e)">{{ t('detail.discard') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="dlg === 'editPending'" @update:open="dlg = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dlg.editTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('dlg.editBody') }} <strong class="text-foreground">{{ t('dlg.editStrong') }}</strong>{{ t('dlg.editTail') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="reopen(e)">{{ t('dlg.editAction') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="dlg === 'editArchived'" @update:open="dlg = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dlg.archEditTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('dlg.archEditBody') }} <strong class="text-foreground">{{ t('dlg.archEditStrong') }}</strong>{{ t('dlg.archEditTail') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="editingArchived = true; load()">{{ t('dlg.archEditAction') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="dlg === 'conflict'" @update:open="dlg = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dlg.conflictTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('dlg.conflictBody') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <div class="flex gap-2 rounded-md border border-[#F5D9A0] bg-[#FDF6E7] px-3 py-2.5 text-[13px] leading-normal text-[#7A4300]">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ t('dlg.conflictWarn') }}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('dlg.conflictKeep') }}</AlertDialogCancel>
          <AlertDialogAction @click="fetchEntry(e.id).then(load)"><RefreshCw aria-hidden="true" />{{ t('dlg.conflictRefresh') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog :open="dlg === 'reject'" @update:open="dlg = null">
      <DialogContent>
        <form class="contents" @submit.prevent="doReject">
          <DialogHeader>
            <DialogTitle>{{ t('dlg.rejectTitle', { name: e.submitted_by ?? '' }) }}</DialogTitle>
            <DialogDescription>{{ t('dlg.rejectBody', { name: e.submitted_by ?? '' }) }}</DialogDescription>
          </DialogHeader>
          <div>
            <label for="rej-reason" class="text-sm font-medium">{{ t('dlg.rejectLabel') }} <span class="text-destructive">*</span></label>
            <Textarea
              id="rej-reason" v-model="reason" rows="4" :placeholder="t('dlg.rejectPlaceholder')"
              :aria-invalid="reasonErr && !reason.trim()" class="mt-2 min-h-24 bg-card" @input="reasonErr = false"
            />
            <div v-if="reasonErr && !reason.trim()" class="mt-1.5 text-xs text-destructive">{{ t('dlg.rejectRequired') }}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" class="bg-card" @click="dlg = null">{{ t('common.cancel') }}</Button>
            <Button type="submit">{{ t('dlg.rejectAction') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
