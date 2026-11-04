<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { File as FileIcon, Upload, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import { createEntry } from '@/mock'

const router = useRouter()
const text = ref('')
const date = ref(new Date().toLocaleDateString('sv')) // sv locale = YYYY-MM-DD in local time
const files = ref<{ id: number; file: File; url?: string }[]>([])
const over = ref(false)
let uid = 0

function add(list: FileList | null | undefined) {
  over.value = false
  for (const file of list ?? []) files.value.push({ id: uid++, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined })
}
function remove(id: number) {
  const f = files.value.find((x) => x.id === id)
  if (f?.url) URL.revokeObjectURL(f.url)
  files.value = files.value.filter((x) => x.id !== id)
}
onBeforeUnmount(() => files.value.forEach((f) => f.url && URL.revokeObjectURL(f.url)))

const size = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const ext = (n: string) => n.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase() ?? 'FILE'

function generate() {
  const id = createEntry(text.value, date.value, files.value.map((f) => f.file))
  files.value = [] // object URLs now belong to the entry's attachments
  router.push(`/entries/${id}`)
}
</script>

<template>
  <main class="mx-auto max-w-[760px] px-4 pt-5 pb-24 md:px-6 md:pt-7 md:pb-20">
    <nav :aria-label="t('common.breadcrumb')" class="hidden gap-1.5 text-[13px] text-faint md:flex">
      <RouterLink to="/" class="text-muted-foreground no-underline">{{ t('list.title') }}</RouterLink><span aria-hidden="true">/</span><span>{{ t('nav.new') }}</span>
    </nav>
    <h1 class="text-[22px] font-semibold tracking-tight md:mt-2.5">{{ t('new.title') }}</h1>
    <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ t('new.intro') }}</p>

    <form class="mt-6 flex flex-col gap-5.5 rounded-[10px] border bg-card p-4 md:p-6" @submit.prevent="generate">
      <div>
        <label for="new-text" class="mb-2 block text-sm font-medium">{{ t('new.textLabel') }}</label>
        <Textarea id="new-text" v-model="text" :placeholder="t('new.textPlaceholder')" class="min-h-[260px] rounded-lg bg-card px-3.5 py-3 text-[15px] leading-[1.7] md:text-sm" />
        <div class="mt-1.5 text-xs text-faint">{{ t('new.chars', { n: text.length }) }}</div>
      </div>

      <div class="max-w-[220px]">
        <label for="new-date" class="mb-2 block text-sm font-medium">{{ t('field.date') }}</label>
        <input id="new-date" v-model="date" type="date" class="h-11 w-full rounded-md border border-input bg-card px-2.5 text-sm md:h-[38px]">
      </div>

      <div>
        <div class="mb-2 text-sm font-medium">{{ t('new.attachments') }}</div>
        <label
          for="new-files"
          class="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed p-5 text-center"
          :class="over ? 'border-link bg-[#F2F6FF]' : 'border-[#C9C9C2] bg-field'"
          @dragover.prevent="over = true"
          @dragleave="over = false"
          @drop.prevent="add($event.dataTransfer?.files)"
        >
          <Upload class="size-[22px] text-muted-foreground" :stroke-width="1.8" aria-hidden="true" />
          <span class="text-sm"><span class="font-medium underline underline-offset-3">{{ t('new.pick') }}</span>{{ t('new.orDrop') }}</span>
          <span class="text-xs text-faint">{{ t('new.fileHint') }}</span>
        </label>
        <input id="new-files" type="file" multiple class="sr-only" @change="add(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">

        <template v-if="files.length">
          <div class="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-3">
            <div v-for="f in files" :key="f.id" class="relative overflow-hidden rounded-lg border bg-card">
              <img v-if="f.url" :src="f.url" :alt="f.file.name" class="aspect-4/3 w-full object-cover">
              <div v-else class="flex aspect-4/3 flex-col items-center justify-center gap-1.5 bg-field text-muted-foreground">
                <FileIcon class="size-[22px]" :stroke-width="1.6" aria-hidden="true" />
                <span class="rounded-[3px] bg-line px-1.5 py-px font-mono text-[11px] font-medium tracking-wider text-ink-2">{{ ext(f.file.name) }}</span>
              </div>
              <div class="border-t border-line px-2.5 py-2">
                <div class="truncate font-mono text-xs">{{ f.file.name }}</div>
                <div class="mt-0.5 text-[11px] text-faint">{{ size(f.file.size) }}</div>
              </div>
              <button
                type="button" :aria-label="t('new.remove', { name: f.file.name })"
                class="absolute top-1.5 right-1.5 flex size-8 cursor-pointer items-center justify-center rounded-full border bg-white/95 text-ink-2 md:size-[26px]"
                @click="remove(f.id)"
              ><X class="size-[13px]" :stroke-width="2.2" aria-hidden="true" /></button>
            </div>
          </div>
          <div class="mt-2 text-xs text-faint">{{ t('new.fileCount', { n: files.length }) }}</div>
        </template>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-4.5">
        <Button as-child variant="outline" class="h-11 bg-card md:h-[38px]">
          <RouterLink to="/" class="text-foreground no-underline">{{ t('common.cancel') }}</RouterLink>
        </Button>
        <Button type="submit" class="h-11 px-4 md:h-[38px]" :disabled="!text.trim() && !files.length">{{ t('new.generate') }}</Button>
      </div>
    </form>
  </main>
</template>
