import { create } from 'zustand';

/**
 * Cross-screen admin state (spec §3.4 socket wiring, A-6/A-11):
 *
 *  - `pendingCount` powers the Drivers-tab badge; it is bumped optimistically
 *    on each `admin:application:new` event and then corrected by a counts
 *    fetch in AdminNavigator.
 *  - `newApplicationSeq` increments per socket event so Overview/Drivers can
 *    refetch when a driver submits without a pull-to-refresh.
 *  - `dataSeq` increments after any admin mutation (approve/reject/suspend/
 *    reinstate/cancel/payment) so lists in other tabs refetch on their own —
 *    fixes stale rows after an action (A-6) without focus-effect hacks.
 */
interface AdminState {
  pendingCount: number;
  newApplicationSeq: number;
  dataSeq: number;
  setPendingCount: (count: number) => void;
  notifyNewApplication: () => void;
  notifyDataChanged: () => void;
  reset: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  pendingCount: 0,
  newApplicationSeq: 0,
  dataSeq: 0,
  setPendingCount: (count) => set({ pendingCount: count }),
  notifyNewApplication: () =>
    set((s) => ({
      newApplicationSeq: s.newApplicationSeq + 1,
      pendingCount: s.pendingCount + 1,
    })),
  notifyDataChanged: () => set((s) => ({ dataSeq: s.dataSeq + 1 })),
  reset: () => set({ pendingCount: 0, newApplicationSeq: 0, dataSeq: 0 }),
}));
