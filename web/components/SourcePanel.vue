<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronDown, File as FileIcon, Image, Info, PanelLeftClose } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n'
import type { Entry, Section } from '@/api'
import Avatar from './Avatar.vue'

const props = defineProps<{
  entry: Entry
  sections?: Section[] // pass the editable sections to enable "Add to…"
  collapsible?: boolean
}>()
const emit = defineEmits<{ collapse: []; add: [attachmentId: number, section: number] }>()

const AI_IMAGE_LIMIT = 20
const isImage = (name: string) => /\.(jpe?g|png|gif|webp|heic)$/i.test(name)
const hm = (at: string) => at.slice(11, 16)

const usedIn = computed(() => {
  const m = new Map<number, number>()
  ;(props.sections ?? props.entry.entry?.sections ?? []).forEach((s, i) => s.images.forEach((im) => m.has(im.attachment_id) || m.set(im.attachment_id, i)))
  return m
})
const allSections = computed(() => props.sections ?? props.entry.entry?.sections ?? [])
const images = computed(() => props.entry.attachments.filter((a) => isImage(a.filename)))

const subtitle = computed(() => {
  const e = props.entry
  const msgs = e.source_messages
  if (!msgs.length) return t(e.kind === 'quick' ? 'source.quick' : 'source.web', { time: e.created_at.slice(5) })
  return t('source.session', {
    channel: e.channel ?? '',
    n: msgs.length,
    p: new Set(msgs.map((m) => m.author)).size,
    range: `${msgs[0].at.slice(5)}–${hm(msgs[msgs.length - 1].at)}`,
  })
})
const attName = (id: number) => props.entry.attachments.find((a) => a.id === id)
</script>

<template>
  <div class="rounded-[10px] border bg-card">
    <div class="flex items-center gap-2.5 border-b border-line py-3 pr-3.5 pl-4">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">{{ t('source.title') }}</div>
        <div class="mt-0.5 truncate text-xs text-faint">{{ subtitle }}</div>
      </div>
      <Button v-if="collapsible" variant="outline" size="sm" class="h-[30px] bg-card text-xs text-[#4A4A45]" @click="emit('collapse')">
        <PanelLeftClose aria-hidden="true" />{{ t('source.collapse') }}
      </Button>
    </div>

    <ol v-if="entry.source_messages.length" class="py-2">
      <li v-for="(m, i) in entry.source_messages" :key="i" class="flex gap-2.5 px-4 py-2">
        <Avatar :name="m.author" :size="30" />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-[13px] font-semibold">{{ m.author }}</span>
            <time class="font-mono text-[11px] text-faint">{{ hm(m.at) }}</time>
          </div>
          <p class="mt-0.5 text-sm leading-relaxed text-[#2A2A27]">{{ m.content }}</p>
          <div v-for="id in m.attachment_ids" :key="id" class="mt-1.5 w-[132px] overflow-hidden rounded-md border">
            <img v-if="attName(id)?.url" :src="attName(id)!.url" :alt="attName(id)!.filename" class="h-[76px] w-full object-cover">
            <div v-else role="img" :aria-label="attName(id)?.filename" class="flex h-[76px] items-center justify-center bg-[repeating-linear-gradient(135deg,#EFEFEB_0_8px,#E6E6E1_8px_16px)] text-[#8A8A84]">
              <Image class="size-[18px]" :stroke-width="1.6" aria-hidden="true" />
            </div>
            <div class="truncate px-2 py-1 font-mono text-[11px] text-[#4A4A45]">{{ attName(id)?.filename }}</div>
          </div>
        </div>
      </li>
    </ol>
    <div v-else-if="entry.source_text" class="px-4 py-3.5">
      <div class="flex items-center gap-2 text-xs text-faint">
        <Avatar :name="entry.created_by" :size="22" />
        {{ t('source.pasted', { name: entry.created_by }) }} · <span class="font-mono">{{ entry.created_at }}</span>
      </div>
      <pre class="mt-2.5 rounded-lg border border-line bg-field px-3.5 py-3 font-sans text-sm leading-[1.7] break-words whitespace-pre-wrap text-[#2A2A27]">{{ entry.source_text }}</pre>
    </div>

    <div class="border-t border-line px-4 pt-3.5 pb-4">
      <div class="flex items-center justify-between gap-2">
        <div class="text-[13px] font-semibold">{{ t('source.attachments') }} <span class="font-normal text-faint">· {{ t('source.imageCount', { n: images.length }) }}</span></div>
        <div class="text-xs text-faint">{{ t('source.usedCount', { n: images.filter((a) => usedIn.has(a.id)).length }) }}</div>
      </div>
      <div v-if="images.length > AI_IMAGE_LIMIT" role="note" class="mt-2.5 flex gap-2 rounded-md border border-[#C9D8FF] bg-[#F2F6FF] px-3 py-2.5 text-xs leading-normal text-[#1E3F9E]">
        <Info class="mt-px size-[15px] shrink-0" aria-hidden="true" />{{ t('source.tooMany', { n: AI_IMAGE_LIMIT }) }}
      </div>
      <div v-if="!entry.attachments.length" class="mt-2.5 rounded-lg border border-dashed border-input p-4.5 text-center text-[13px] text-faint">{{ t('source.noImages') }}</div>

      <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-3">
        <div v-for="a in entry.attachments" :key="a.id" class="rounded-lg border bg-card">
          <div class="relative aspect-4/3 overflow-hidden rounded-t-lg">
            <img v-if="a.url" :src="a.url" :alt="a.filename" class="size-full object-cover">
            <div v-else role="img" :aria-label="a.filename" class="flex size-full items-center justify-center bg-[repeating-linear-gradient(135deg,#EFEFEB_0_8px,#E6E6E1_8px_16px)] text-[#8A8A84]">
              <component :is="isImage(a.filename) ? Image : FileIcon" class="size-[22px]" :stroke-width="1.6" aria-hidden="true" />
            </div>
            <span v-if="usedIn.has(a.id)" class="absolute top-1.5 left-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-[#1D6B3A] px-[7px] text-[11px] font-medium text-white">
              <Check class="size-[11px]" :stroke-width="3" aria-hidden="true" />{{ t('source.usedIn', { name: allSections[usedIn.get(a.id)!]?.subsystem ?? '' }) }}
            </span>
          </div>
          <div class="flex flex-col gap-1.5 px-2.5 py-2">
            <a v-if="!a.url && a.orig_url" :href="a.orig_url" class="truncate font-mono text-[11px] text-ink-2">{{ a.filename }}</a>
            <div v-else class="truncate font-mono text-[11px] text-ink-2">{{ a.filename }}</div>
            <div v-if="a.from" class="text-[11px] text-faint">{{ a.from }}</div>
            <DropdownMenu v-if="sections && isImage(a.filename)">
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="h-11 w-full justify-between bg-card px-2 text-xs font-normal md:h-[30px]">
                  {{ t('source.addTo') }}<ChevronDown class="size-[13px]" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-48">
                <DropdownMenuLabel class="text-[11px] font-normal text-faint">{{ t('source.addToWhich') }}</DropdownMenuLabel>
                <DropdownMenuItem v-for="(s, i) in sections" :key="i" class="h-11 justify-between md:h-[30px]" @select="emit('add', a.id, i)">
                  Section {{ i + 1 }} · {{ s.subsystem }}
                  <Check v-if="s.images.some((im) => im.attachment_id === a.id)" class="size-3.5 text-[#1D6B3A]" aria-hidden="true" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
