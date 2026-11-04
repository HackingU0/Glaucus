<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Avatar from '@/components/Avatar.vue'
import LangSwitch from '@/components/LangSwitch.vue'
import { t } from '@/i18n'
import { me, register } from '@/api'

const router = useRouter()
const name = ref('')
async function confirm() {
  if (!name.value.trim()) return
  await register(name.value.trim())
  router.push('/')
}
</script>

<template>
  <div class="relative flex min-h-dvh items-center justify-center bg-background bg-[linear-gradient(#ECECE7_1px,transparent_1px),linear-gradient(90deg,#ECECE7_1px,transparent_1px)] bg-size-[24px_24px] px-4 py-6">
    <div class="absolute top-4 right-4"><LangSwitch /></div>
    <form class="w-full max-w-[400px] rounded-xl border bg-card p-8 shadow-[0_1px_2px_rgba(0,0,0,.04)]" @submit.prevent="confirm">
      <div class="flex items-center gap-2.5">
        <Avatar :name="me.real_name" :size="36" />
        <div>
          <div class="text-[13px] text-muted-foreground">{{ t('register.signedIn') }}</div>
          <div class="font-mono text-[13px]">@{{ me.discord_name }}</div>
        </div>
      </div>
      <h1 class="mt-6 text-lg font-semibold">{{ t('register.title') }}</h1>
      <div class="mt-4.5">
        <label for="reg-name" class="block text-sm font-medium">{{ t('register.label') }}</label>
        <Input id="reg-name" v-model="name" :placeholder="t('register.placeholder')" autocomplete="name" class="mt-2 h-[42px] rounded-lg bg-card text-[15px]" />
        <div class="mt-1.5 text-xs text-faint">{{ t('register.hint') }}</div>
      </div>
      <Button type="submit" :disabled="!name.trim()" class="mt-5.5 h-11 w-full rounded-lg text-[15px]">{{ t('register.confirm') }}</Button>
    </form>
  </div>
</template>
