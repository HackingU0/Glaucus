// ponytail: ~20-line t() instead of vue-i18n; flat keys, {param} interpolation, plurals via Intl.PluralRules.
// Switch to vue-i18n if we ever need ICU select/date formats or lazy-loaded locale bundles.
import { ref, watchEffect } from 'vue'
import en from './locales/en'
import es from './locales/es'
import zh from './locales/zh'

export type Key = keyof typeof en
export type Msg = string | { one: string; other: string }
export type Messages = Record<Key, Msg>

const messages: Record<string, Messages> = { en, es, zh }
export const LOCALES = { en: 'English', es: 'Español', zh: '中文' } as const
export type Locale = keyof typeof LOCALES

const read = () => { try { return localStorage.getItem('locale') } catch { return null } }
const saved = read()
const nav = navigator.language.toLowerCase()
export const locale = ref<Locale>(
  saved && saved in LOCALES ? (saved as Locale) : nav.startsWith('zh') ? 'zh' : nav.startsWith('es') ? 'es' : 'en',
)

watchEffect(() => {
  document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : locale.value
  try { localStorage.setItem('locale', locale.value) } catch { /* private mode */ }
})

export function t(key: Key, params: Record<string, string | number> = {}): string {
  let m: Msg = messages[locale.value][key] ?? en[key]
  if (typeof m !== 'string') m = new Intl.PluralRules(locale.value).select(Number(params.n)) === 'one' ? m.one : m.other
  return m.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}
