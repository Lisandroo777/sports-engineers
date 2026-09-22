'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DeepSideLogo } from './DeepSideLogo';
import { mainNavigation } from '../lib/navigation';

const NAV_ICONS: Record<string, string> = {
  Games:
    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  'Prop Dive':
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  'DeepSide AI':
    'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  Picks: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  Insights: 'M4 19V5m0 14h16M8 16l3-4 3 2 4-6',
  '+EV': 'M12 4v16m8-8H4',
  Matchups: 'M13 10V3L4 14h7v7l9-11h-7z',
  Settings:
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

function NavIcon({ label }: { label: string }) {
  return (
    <svg aria-hidden="true" className="h-[17px] w-[17px] shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} viewBox="0 0 24 24">
      <path d={NAV_ICONS[label] ?? ''} />
    </svg>
  );
}

interface AppSidebarProps {
  currentPath: string;
  footer?: React.ReactNode;
}

export function AppSidebar({ currentPath, footer }: AppSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const renderNavigation = (items: typeof mainNavigation) => (
    <div className="space-y-1">
      {items.map(({ label, href }) => {
        const isActive = currentPath === href || (href !== '/dashboard' && currentPath.startsWith(href));
        return (
          <Link
            key={label}
            href={href}
            onClick={() => setIsOpen(false)}
            className={`group relative flex min-h-9 items-center gap-3 rounded-lg border px-3 py-2 text-[13px] font-medium tracking-[-0.01em] transition duration-200 ease-out ${isActive ? 'border-white/[0.09] bg-[#111a14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_6px_18px_rgba(0,0,0,0.14)]' : 'border-transparent text-[var(--se-muted)] hover:border-white/[0.05] hover:bg-[var(--se-panel-hover)] hover:text-white'}`}
          >
            <span className={`flex h-[17px] w-[17px] items-center justify-center transition-colors ${isActive ? 'text-[var(--se-green)]' : 'text-[var(--se-muted)] group-hover:text-slate-200'}`}>
              <NavIcon label={label} />
            </span>
            <span className="truncate">{label}</span>
            {isActive ? <span aria-hidden="true" className="absolute left-0 h-4 w-0.5 rounded-full bg-[var(--se-green)] shadow-[0_0_10px_rgba(57,242,127,0.65)]" /> : null}
          </Link>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--se-border)] bg-[var(--se-bg-elevated)] text-[var(--se-muted)] shadow-lg transition hover:border-[var(--se-border-strong)] hover:text-white md:hidden"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {isOpen ? <button type="button" aria-label="Close navigation" onClick={() => setIsOpen(false)} className="fixed inset-0 z-30 bg-black/55 md:hidden" /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[204px] shrink-0 flex-col border-r border-[var(--se-border)] bg-[var(--se-bg-elevated)] shadow-2xl transition-transform duration-200 ease-out md:relative md:z-auto md:translate-x-0 md:shadow-none ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
      {/* Logo */}
      <div className="flex items-center justify-between border-b border-[var(--se-border)] px-3 py-3">
        <DeepSideLogo className="block h-auto w-[148px] max-w-full object-contain" priority />
        <button type="button" aria-label="Close navigation" onClick={() => setIsOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--se-muted)] transition hover:bg-[var(--se-panel-hover)] hover:text-white md:hidden">
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Core</p>
        {renderNavigation(mainNavigation)}
      </nav>

      <div className="border-t border-[var(--se-border)] px-2 py-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--se-green-soft)] text-[10px] font-bold text-[var(--se-green)]">LR</div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white">Pro Plan</p>
            <p className="text-[10px] text-[var(--se-green)]">Active</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Link href="/account" onClick={() => setIsOpen(false)} className="rounded-lg px-2 py-1.5 text-center text-[11px] text-[var(--se-muted)] transition hover:bg-[var(--se-panel-hover)] hover:text-white">Account</Link>
          <Link href="/settings" onClick={() => setIsOpen(false)} className="rounded-lg px-2 py-1.5 text-center text-[11px] text-[var(--se-muted)] transition hover:bg-[var(--se-panel-hover)] hover:text-white">Settings</Link>
        </div>
      </div>

      {footer}
      </aside>
    </>
  );
}
