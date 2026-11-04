<script setup lang="ts">
// Editable list of strings (goals, problems, alternatives, next steps): one input per row,
// delete per row, "+ Add" at the end. Mutates `items` in place.
import { Plus, X } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { NI } from '@/mock'

defineProps<{ items: string[]; label: string }>()
const emit = defineEmits<{ touch: [] }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div v-for="(_, i) in items" :key="i" class="flex items-center gap-1.5">
      <Input
        v-model="items[i]" :aria-label="`${label} ${i + 1}`"
        :data-ni="items[i].includes(NI) ? '' : undefined" :class="items[i].includes(NI) && 'ni-field'"
        class="h-11 flex-1 bg-card px-2.5 text-[15px] md:h-9 md:text-sm"
      />
      <button
        type="button" :aria-label="t('form.deleteItem', { item: `${label} ${i + 1}` })"
        class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-muted md:size-[30px]"
        @click="items.splice(i, 1); emit('touch')"
      ><X class="size-3.5" aria-hidden="true" /></button>
    </div>
    <button
      type="button"
      class="inline-flex h-11 cursor-pointer items-center gap-1 self-start rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted md:h-[30px]"
      @click="items.push(''); emit('touch')"
    ><Plus class="size-3.5" aria-hidden="true" />{{ t('form.add') }}</button>
  </div>
</template>
