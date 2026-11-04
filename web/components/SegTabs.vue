<script setup lang="ts">
// Segmented control from the design (grey track, white active pill). `pills` switches to
// the mobile list's chip style below md.
defineProps<{ items: { key: string; label: string; count?: number; countClass?: string }[]; pills?: boolean }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    class="flex max-w-full gap-0.5 overflow-x-auto rounded-lg [scrollbar-width:none] md:w-max md:bg-track md:p-[3px]"
    :class="pills ? 'gap-2 md:gap-0.5' : 'w-max bg-track p-[3px]'"
    role="tablist"
  >
    <button
      v-for="it in items"
      :key="it.key"
      type="button"
      role="tab"
      :aria-selected="model === it.key"
      class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-[13px]"
      :class="[
        pills ? 'h-9 rounded-full border px-3.5 md:h-[30px] md:rounded-md md:border-0 md:px-3' : 'h-[30px] rounded-md px-3',
        model === it.key
          ? (pills ? 'border-primary bg-primary font-medium text-primary-foreground md:bg-card md:text-foreground md:shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]')
          : (pills ? 'border-input bg-card text-ink-2 md:bg-transparent md:text-muted-foreground' : 'bg-transparent text-muted-foreground'),
      ]"
      @click="model = it.key"
    >
      {{ it.label }}
      <span
        v-if="it.count"
        class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] font-semibold"
        :class="it.countClass ?? 'bg-[#DCDCD6] text-ink-2'"
      >{{ it.count }}</span>
    </button>
  </div>
</template>
