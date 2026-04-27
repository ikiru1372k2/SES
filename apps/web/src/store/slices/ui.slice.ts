/**
 * UI slice — sidebar, panels, and modal state.
 * Acts as a hook point for future global UI flags so they don't land
 * back in the monolithic store.
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from '../types';

export type UiSlice = Pick<AppStore, 'sidebarCollapsed' | 'setSidebarCollapsed'>;

export const createUiSlice: StateCreator<AppStore, [], [], UiSlice> = (set) => ({
  sidebarCollapsed: false,

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
});
