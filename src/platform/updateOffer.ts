// The "a newer build is ready" offer the on-launch update check raises (rendered by
// UpdateNotice.tsx, mounted once in App). Kept apart from the toast store because it carries an
// action.

import { create } from 'zustand'
import type { UpdateInfo } from './updates'

interface UpdateOfferState {
  offer: UpdateInfo | null
  show: (offer: UpdateInfo) => void
  dismiss: () => void
}

export const useUpdateOffer = create<UpdateOfferState>((set) => ({
  offer: null,
  show: (offer) => set({ offer }),
  dismiss: () => set({ offer: null }),
}))
