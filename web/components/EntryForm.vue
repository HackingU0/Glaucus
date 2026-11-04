<script setup lang="ts">
// The NotebookEntry editor. Mutates `note` in place; `ai` holds what is still untouched AI output
// ('title' | 'time' | 'attendees' | 'goals' | 'next_steps' and Section objects).
import { ref } from 'vue'
import { ArrowDown, ArrowUp, Image, Plus, Trash2, X } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import { NI, SUBSYSTEMS, isRegistered, type Attachment, type NotebookEntry, type Section } from '@/api'
import TextList from './TextList.vue'

const props = defineProps<{ note: NotebookEntry; ai: Set<unknown>; attachments: Attachment[]; draftedAt?: string }>()

const ni = (v: string | null | undefined) => !!v?.includes(NI)
const niAttrs = (v: string | null | undefined) => (ni(v) ? { 'data-ni': '', class: 'ni-field' } : {})
const touch = (k: unknown) => props.ai.delete(k)

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

const adding = ref(false)
const newName = ref('')
function commitAttendee() {
  if (newName.value.trim()) { props.note.attendees.push(newName.value.trim()); touch('attendees') }
  adding.value = false
  newName.value = ''
}
function addSection() {
  props.note.sections.push({ subsystem: 'Software', work_done: '', problems: [''], decisions: [], test_results: null, images: [] })
}
const file = (id: number) => props.attachments.find((a) => a.id === id)

const label = 'mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-2'
const sub = 'mb-1.5 block text-xs font-medium text-ink-2'
const field = 'h-11 bg-card px-2.5 text-[15px] md:h-9 md:text-sm'
const area = 'min-h-0 bg-card px-2.5 py-2 text-[15px] leading-relaxed md:text-sm'
const iconBtn = 'flex size-11 cursor-pointer items-center justify-center rounded-md border bg-card text-ink-2 disabled:cursor-default disabled:opacity-40 md:size-[30px]'
const addBtn = 'inline-flex h-11 cursor-pointer items-center gap-1 self-start rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted md:h-[30px]'
</script>

<template>
  <div class="flex flex-col gap-5.5">
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-lg border border-line bg-field px-3 py-2.5 text-xs text-muted-foreground">
      <span class="inline-flex items-center gap-1.5"><span class="ai-tag">AI</span>{{ t('form.legendAi') }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="rounded-[3px] border border-ni-line bg-ni px-1 font-mono text-[11px] leading-4 text-ni-ink">[needs input]</span>{{ t('form.legendNi') }}</span>
      <span v-if="draftedAt">{{ t('form.draftedAt', { time: draftedAt.slice(5) }) }}</span>
    </div>

    <div @input="touch('title')">
      <div :class="label"><label for="f-title">{{ t('field.title') }}</label><span v-if="ai.has('title')" class="ai-tag" :title="t('form.legendAi')">AI</span></div>
      <Input id="f-title" v-model="note.title" v-bind="niAttrs(note.title)" :class="field" class="text-[15px] font-medium md:text-[15px]" />
    </div>

    <div @input="touch('time')">
      <div :class="label">{{ t('form.dateTime') }}<span v-if="ai.has('time')" class="ai-tag" :title="t('form.legendAi')">AI</span></div>
      <div class="flex flex-wrap gap-2.5">
        <div class="min-w-0 flex-[1.4_1_140px]">
          <label for="f-date" class="mb-1 block text-xs text-muted-foreground">{{ t('field.date') }}</label>
          <Input id="f-date" v-model="note.date" v-bind="niAttrs(note.date)" :class="field" class="font-mono md:text-[13px]" />
        </div>
        <div class="min-w-0 flex-[1_1_96px]">
          <label for="f-start" class="mb-1 block text-xs text-muted-foreground">{{ t('field.start') }}</label>
          <Input id="f-start" v-model="note.start_time" v-bind="niAttrs(note.start_time)" :class="field" class="font-mono md:text-[13px]" />
        </div>
        <div class="min-w-0 flex-[1_1_96px]">
          <label for="f-end" class="mb-1 block text-xs text-muted-foreground">{{ t('field.end') }}</label>
          <Input id="f-end" v-model="note.end_time" v-bind="niAttrs(note.end_time)" :class="field" class="font-mono md:text-[13px]" />
        </div>
      </div>
    </div>

    <div>
      <div :class="label">
        {{ t('field.attendees') }}<span class="text-xs font-normal text-faint">{{ t('form.people', { n: note.attendees.length }) }}</span>
        <span v-if="ai.has('attendees')" class="ai-tag" :title="t('form.legendAi')">AI</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-for="(a, i) in note.attendees" :key="a + i"
          class="inline-flex h-11 items-center gap-1.5 rounded-full border pr-0.5 pl-2.5 text-[13px] md:h-[30px]"
          :class="isRegistered(a) ? 'border-input bg-background' : 'border-dashed border-[#9A9A93] bg-card text-ink-2'"
        >
          {{ a }}
          <span v-if="!isRegistered(a)" :title="t('form.unregisteredHint')" class="rounded-[3px] bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">unregistered</span>
          <button type="button" :aria-label="t('form.removePerson', { name: a })" class="flex size-10 cursor-pointer items-center justify-center rounded-full text-faint md:size-6" @click="note.attendees.splice(i, 1); touch('attendees')">
            <X class="size-3" aria-hidden="true" />
          </button>
        </span>
        <form v-if="adding" class="inline-flex items-center gap-1.5" @submit.prevent="commitAttendee" @keydown.esc="adding = false">
          <input v-model="newName" :aria-label="t('form.newPerson')" :placeholder="t('form.name')" autofocus class="h-11 w-[140px] rounded-full border border-link bg-card px-2.5 text-[13px] outline-none md:h-[30px]">
          <button type="submit" class="h-11 cursor-pointer rounded-full bg-primary px-3 text-xs text-primary-foreground md:h-[30px]">{{ t('form.add') }}</button>
        </form>
        <button v-else type="button" class="inline-flex h-11 cursor-pointer items-center gap-1 rounded-full border border-dashed border-[#C9C9C2] px-2.5 text-[13px] text-muted-foreground md:h-[30px]" @click="adding = true">
          <Plus class="size-3" aria-hidden="true" />{{ t('form.add') }}
        </button>
      </div>
    </div>

    <div @input="touch('goals')">
      <div :class="label">{{ t('field.goals') }}<span v-if="ai.has('goals')" class="ai-tag" :title="t('form.legendAi')">AI</span></div>
      <TextList :items="note.goals" :label="t('field.goal')" @touch="touch('goals')" />
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-baseline gap-2">
        <span class="text-[13px] font-medium text-ink-2">Sections</span>
        <span class="text-xs text-faint">{{ t('form.sectionCount', { n: note.sections.length }) }}</span>
      </div>

      <section
        v-for="(s, si) in note.sections" :key="si" :aria-label="`Section ${si + 1}`"
        class="rounded-[10px] border bg-card" @input="touch(s)" @change="touch(s)"
      >
        <div class="flex flex-wrap items-center gap-2 rounded-t-[10px] border-b border-line bg-field px-3 py-2.5">
          <span class="font-mono text-xs text-muted-foreground">Section {{ si + 1 }}</span>
          <label :for="`f-sub-${si}`" class="sr-only">{{ t('field.subsystem') }}</label>
          <select :id="`f-sub-${si}`" v-model="s.subsystem" class="h-11 rounded-md border border-input bg-card pr-7 pl-2.5 text-[13px] font-medium md:h-[30px]">
            <option v-for="o in SUBSYSTEMS" :key="o">{{ o }}</option>
          </select>
          <span v-if="ai.has(s)" class="ai-tag" :title="t('form.sectionAi')">AI</span>
          <div class="flex-1" />
          <div class="flex gap-0.5">
            <button type="button" :aria-label="t('form.moveUp', { what: `Section ${si + 1}` })" :disabled="si === 0" :class="iconBtn" @click="move(note.sections, si, -1)"><ArrowUp class="size-3.5" aria-hidden="true" /></button>
            <button type="button" :aria-label="t('form.moveDown', { what: `Section ${si + 1}` })" :disabled="si === note.sections.length - 1" :class="iconBtn" @click="move(note.sections, si, 1)"><ArrowDown class="size-3.5" aria-hidden="true" /></button>
            <button type="button" :aria-label="t('form.deleteItem', { item: `Section ${si + 1}` })" :class="iconBtn" class="text-[#B42318]" @click="note.sections.splice(si, 1)"><Trash2 class="size-3.5" aria-hidden="true" /></button>
          </div>
        </div>

        <div class="flex flex-col gap-4.5 p-4">
          <div>
            <label :for="`f-work-${si}`" :class="sub">{{ t('field.workDone') }}</label>
            <Textarea :id="`f-work-${si}`" v-model="s.work_done" rows="3" v-bind="niAttrs(s.work_done)" :class="area" />
          </div>

          <div>
            <div :class="sub">{{ t('field.problems') }}</div>
            <TextList :items="s.problems" :label="t('field.problem')" @touch="touch(s)" />
          </div>

          <div>
            <div :class="sub">{{ t('field.decisions') }}</div>
            <div class="flex flex-col gap-2.5">
              <div v-for="(d, di) in s.decisions" :key="di" class="flex flex-col gap-3 rounded-lg border bg-[#FCFCFB] p-3">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[11px] text-muted-foreground">{{ t('field.decision') }} {{ di + 1 }}</span>
                  <div class="flex-1" />
                  <button type="button" class="h-11 cursor-pointer rounded-md px-2 text-xs text-[#B42318] md:h-[30px]" @click="s.decisions.splice(di, 1); touch(s)">{{ t('common.delete') }}</button>
                </div>
                <div>
                  <label :for="`f-d-${si}-${di}`" class="mb-1 block text-xs text-muted-foreground">{{ t('field.decision') }}</label>
                  <Input :id="`f-d-${si}-${di}`" v-model="d.decision" v-bind="niAttrs(d.decision)" :class="field" class="font-medium" />
                </div>
                <div>
                  <div class="mb-1 text-xs text-muted-foreground">{{ t('field.alternatives') }}</div>
                  <TextList :items="d.alternatives_considered" :label="t('field.alternative')" @touch="touch(s)" />
                </div>
                <div>
                  <label :for="`f-w-${si}-${di}`" class="mb-1 block text-xs text-muted-foreground">{{ t('field.rationale') }}</label>
                  <Textarea :id="`f-w-${si}-${di}`" v-model="d.rationale" rows="2" v-bind="niAttrs(d.rationale)" :class="area" />
                </div>
              </div>
              <div v-if="!s.decisions.length" class="rounded-lg border border-dashed border-input p-3 text-[13px] text-faint">{{ t('form.noDecisions') }}</div>
              <button type="button" :class="addBtn" @click="s.decisions.push({ decision: '', alternatives_considered: [''], rationale: '' }); touch(s)">
                <Plus class="size-3.5" aria-hidden="true" />{{ t('form.addDecision') }}
              </button>
            </div>
          </div>

          <div>
            <div class="mb-1.5 flex items-baseline gap-1.5">
              <label :for="`f-test-${si}`" class="text-xs font-medium text-ink-2">{{ t('field.testResults') }}</label>
              <span class="text-[11px] text-faint">{{ t('form.optional') }}</span>
            </div>
            <Textarea
              :id="`f-test-${si}`" :model-value="s.test_results ?? ''" rows="2" :placeholder="t('form.testPlaceholder')"
              v-bind="niAttrs(s.test_results)" :class="area" @update:model-value="(v) => (s.test_results = String(v) || null)"
            />
          </div>

          <div>
            <div :class="sub">{{ t('field.images') }}</div>
            <div v-if="!s.images.length" class="rounded-lg border border-dashed border-input p-3.5 text-[13px] text-faint">{{ t('form.noImages') }}</div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-3">
              <figure v-for="(im, ii) in s.images" :key="im.attachment_id" class="overflow-hidden rounded-lg border bg-card">
                <img v-if="file(im.attachment_id)?.url" :src="file(im.attachment_id)!.url" :alt="file(im.attachment_id)!.filename" class="aspect-4/3 w-full object-cover">
                <div v-else role="img" :aria-label="file(im.attachment_id)?.filename" class="flex aspect-4/3 flex-col items-center justify-center gap-1.5 bg-[repeating-linear-gradient(135deg,#EFEFEB_0_8px,#E6E6E1_8px_16px)] text-[#8A8A84]">
                  <Image class="size-[22px]" :stroke-width="1.6" aria-hidden="true" />
                  <span class="font-mono text-[11px] text-muted-foreground">{{ file(im.attachment_id)?.filename }}</span>
                </div>
                <div class="flex flex-col gap-2 p-2">
                  <Input v-model="im.caption" :aria-label="t('form.caption') + ' ' + (file(im.attachment_id)?.filename ?? '')" :placeholder="t('form.caption')" v-bind="niAttrs(im.caption)" :class="field" class="px-2 md:text-[13px]" />
                  <div class="flex gap-1">
                    <button type="button" :aria-label="t('form.moveUp', { what: t('form.image') })" :disabled="ii === 0" :class="iconBtn" @click="move(s.images, ii, -1); touch(s)"><ArrowUp class="size-3.5" aria-hidden="true" /></button>
                    <button type="button" :aria-label="t('form.moveDown', { what: t('form.image') })" :disabled="ii === s.images.length - 1" :class="iconBtn" @click="move(s.images, ii, 1); touch(s)"><ArrowDown class="size-3.5" aria-hidden="true" /></button>
                    <div class="flex-1" />
                    <button type="button" class="h-11 cursor-pointer rounded-md px-2 text-xs text-muted-foreground md:h-[30px]" @click="s.images.splice(ii, 1); touch(s)">{{ t('common.remove') }}</button>
                  </div>
                </div>
              </figure>
            </div>
          </div>
        </div>
      </section>

      <button type="button" class="flex h-[52px] cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-[#C9C9C2] text-sm text-[#4A4A45] md:h-11" @click="addSection">
        <Plus class="size-4" aria-hidden="true" />{{ t('form.addSection') }}
      </button>
    </div>

    <div @input="touch('next_steps')">
      <div :class="label">{{ t('field.nextSteps') }}<span v-if="ai.has('next_steps')" class="ai-tag" :title="t('form.legendAi')">AI</span></div>
      <TextList :items="note.next_steps" :label="t('field.nextStep')" @touch="touch('next_steps')" />
    </div>
  </div>
</template>
