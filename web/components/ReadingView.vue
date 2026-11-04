<script setup lang="ts">
// The formal notebook page. Its labels stay English on purpose: this is the notebook itself
// (what judges read), not app chrome, so it doesn't follow the UI language.
import type { Attachment, NotebookEntry } from '@/api'
import NiText from './NiText.vue'

const props = defineProps<{
  note: NotebookEntry
  attachments: Attachment[]
  entryNo: string
  sigs: { role: string; who: string; when: string; muted?: boolean }[]
}>()

const figNo = (i: number, k: number) => props.note.sections.slice(0, i).reduce((n, s) => n + s.images.length, 0) + k + 1
const file = (id: number) => props.attachments.find((a) => a.id === id)
const h3 = 'mt-4 font-sans text-xs font-semibold tracking-[.06em] text-muted-foreground uppercase'
</script>

<template>
  <article lang="en" class="rounded-[10px] border bg-card px-[18px] py-[22px] font-serif text-foreground md:px-14 md:py-12">
    <header>
      <div class="flex flex-wrap justify-between gap-x-4 gap-y-1.5 font-mono text-[11px] tracking-[.08em] text-muted-foreground uppercase">
        <span>Engineering Notebook</span>
        <span>Entry · {{ entryNo }}</span>
      </div>
      <h1 class="mt-3.5 text-[22px] leading-tight font-semibold tracking-[-0.005em] text-balance md:text-[28px]"><NiText :text="note.title" /></h1>
      <dl class="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-x-6 gap-y-3 border-t border-b border-t-foreground py-3.5 font-sans">
        <div>
          <dt class="text-[11px] tracking-[.06em] text-muted-foreground uppercase">Date</dt>
          <dd class="mt-1 font-mono text-sm"><NiText :text="note.date" /></dd>
        </div>
        <div>
          <dt class="text-[11px] tracking-[.06em] text-muted-foreground uppercase">Time</dt>
          <dd class="mt-1 font-mono text-sm"><NiText :text="note.start_time" /> – <NiText :text="note.end_time" /></dd>
        </div>
        <div class="col-span-full">
          <dt class="text-[11px] tracking-[.06em] text-muted-foreground uppercase">Attendees</dt>
          <dd class="mt-1 text-sm">{{ note.attendees.join(', ') }}</dd>
        </div>
      </dl>
    </header>

    <section v-if="note.goals.length" class="mt-7">
      <h2 class="font-sans text-xs font-semibold tracking-[.08em] text-ink-2 uppercase">Goals</h2>
      <ul class="mt-2 list-disc pl-5 text-base leading-[1.65]"><li v-for="(g, i) in note.goals" :key="i"><NiText :text="g" /></li></ul>
    </section>

    <section v-for="(s, i) in note.sections" :key="i" class="mt-8 border-t pt-5.5">
      <h2 class="flex items-baseline gap-3 font-sans text-lg font-semibold">
        <span class="font-mono text-[13px] font-medium text-muted-foreground">§{{ i + 1 }}</span>{{ s.subsystem }}
      </h2>
      <h3 :class="h3">Work done</h3>
      <p class="mt-1.5 text-base leading-[1.65]"><NiText :text="s.work_done" /></p>

      <template v-if="s.problems.length">
        <h3 :class="h3">Problems</h3>
        <ul class="mt-1.5 list-disc pl-5 text-base leading-[1.65]"><li v-for="(p, k) in s.problems" :key="k"><NiText :text="p" /></li></ul>
      </template>

      <template v-if="s.decisions.length">
        <h3 :class="h3">Decisions</h3>
        <div v-for="(d, k) in s.decisions" :key="k" class="mt-2 overflow-hidden rounded-md border">
          <div class="border-b bg-field px-3.5 py-2.5 text-base leading-normal font-semibold"><NiText :text="d.decision" /></div>
          <dl class="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] gap-x-4 gap-y-2 px-3.5 py-2.5 text-[15px] leading-relaxed">
            <dt class="pt-[3px] font-sans text-xs text-muted-foreground">Alternatives considered</dt>
            <dd><NiText :text="d.alternatives_considered.join('; ')" /></dd>
            <dt class="pt-[3px] font-sans text-xs text-muted-foreground">Rationale</dt>
            <dd><NiText :text="d.rationale" /></dd>
          </dl>
        </div>
      </template>

      <template v-if="s.test_results">
        <h3 :class="h3">Test results</h3>
        <p class="mt-1.5 text-base leading-[1.65]"><NiText :text="s.test_results" /></p>
      </template>

      <figure v-for="(im, k) in s.images" :key="im.attachment_id" class="mt-4.5 max-w-[420px]">
        <img v-if="file(im.attachment_id)?.url" :src="file(im.attachment_id)!.url" :alt="im.caption" class="aspect-4/3 w-full rounded border object-cover">
        <div v-else role="img" :aria-label="im.caption" class="flex aspect-4/3 items-center justify-center rounded border bg-[repeating-linear-gradient(135deg,#F1F1ED_0_8px,#E8E8E3_8px_16px)]">
          <span class="font-mono text-[11px] text-muted-foreground">{{ file(im.attachment_id)?.filename }}</span>
        </div>
        <figcaption class="mt-1.5 text-[13px] leading-normal text-[#4A4A45]"><span class="font-sans font-semibold">Fig. {{ figNo(i, k) }}</span> — <NiText :text="im.caption" /></figcaption>
      </figure>
    </section>

    <section v-if="note.next_steps.length" class="mt-8 border-t pt-5.5">
      <h2 class="font-sans text-xs font-semibold tracking-[.08em] text-ink-2 uppercase">Next steps</h2>
      <ol class="mt-2 list-decimal pl-[22px] text-base leading-[1.65]"><li v-for="(n, i) in note.next_steps" :key="i"><NiText :text="n" /></li></ol>
    </section>

    <footer class="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-4 border-t border-t-foreground pt-4 font-sans">
      <div v-for="g in sigs" :key="g.role">
        <div class="text-[11px] tracking-[.06em] text-muted-foreground uppercase">{{ g.role }}</div>
        <div class="mt-1 text-sm" :class="g.muted ? 'text-faint' : 'font-medium'">{{ g.who }}</div>
        <div class="mt-0.5 font-mono text-xs text-muted-foreground">{{ g.when }}</div>
      </div>
    </footer>
  </article>
</template>
