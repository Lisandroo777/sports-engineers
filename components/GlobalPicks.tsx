'use client';

import { MyPicksDrawer } from './MyPicksDrawer';
import { PicksProvider } from './PicksProvider';

export function GlobalPicks({ children }: { children: React.ReactNode }) {
  return <PicksProvider><>{children}</><MyPicksDrawer /></PicksProvider>;
}
