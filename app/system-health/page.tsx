import type { Metadata } from 'next';
import SystemHealthPanel from '../../components/SystemHealthPanel';

export const metadata: Metadata = {
  title: 'System Health | DeepSide AI',
  robots: { index: false, follow: false },
};

export default function SystemHealthPage() {
  return <SystemHealthPanel />;
}