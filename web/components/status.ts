import type { Entry } from '@/api'
import type { Key } from '@/i18n'

export type UiStatus = 'collecting' | 'generating' | 'draft' | 'pending' | 'archived' | 'discarded' | 'failed'

// Status colors from the design (ui-brief.md table): badge border/bg/text + dot.
export const STATUS: Record<UiStatus, { badge: string; dot: string }> = {
  collecting: { badge: 'border-[#E0E0DA] bg-[#EEEEEA] text-[#4A4A45]', dot: 'bg-[#8A8A84]' },
  generating: { badge: 'border-[#C9D8FF] bg-[#E6EEFF] text-[#1E4BB8]', dot: 'bg-[#2F6BFF] animate-pulse-dot' },
  draft: { badge: 'border-[#D6D6D0] bg-white text-[#3A3A36]', dot: 'bg-[#9A9A93]' },
  pending: { badge: 'border-[#F5D9A0] bg-[#FDF0D5] text-[#8A4B00]', dot: 'bg-[#D98A00]' },
  archived: { badge: 'border-[#BFE3CB] bg-[#E3F4E8] text-[#1D6B3A]', dot: 'bg-[#2F9E5A]' },
  discarded: { badge: 'border-[#E0E0DA] bg-[#F2F2EF] text-faint', dot: 'bg-[#B5B5AE]' },
  failed: { badge: 'border-[#F6C5C1] bg-[#FDE8E8] text-[#B42318]', dot: 'bg-[#D92D20]' },
}

const MAP = {
  collecting: 'collecting', drafting: 'generating', draft_ready: 'draft',
  pending_approval: 'pending', approved: 'archived', discarded: 'discarded',
} as const

/** A failed step shows as "failed" on top of whatever status the entry is in. */
export const uiStatus = (e: Entry): UiStatus => (e.failed_step ? 'failed' : MAP[e.status])
export const statusKey = (s: UiStatus) => ('status.' + s) as Key
export const kindKey = (e: Entry) => ('kind.' + e.kind) as Key
export const stepKey = (e: Entry) => ('step.' + e.failed_step) as Key
