'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DeepSideLogo } from './DeepSideLogo';
import { mainNavigation } from '../lib/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: 'ai' | 'games' | 'research' | 'matchups' | 'picks' | 'favorites' | 'ev' | 'settings' | 'performance';
}

const NAV_MAP: Record<string, NavItem['icon']> = {
  'DeepSide AI': 'ai',
  Games: 'games',
  'Research Lab': 'research',
  'AI Favorites': 'favorites',
  'Best +EV Plays': 'ev',
  Matchups: 'matchups',
  Picks: 'picks',
  Performance: 'performance',
  Settings: 'settings',
  'System Health': 'performance',
};

function NavItemIcon({ icon, isActive }: { icon: NavItem['icon']; isActive: boolean }) {
  if (icon === 'ai') {
    return (
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
          isActive
            ? 'border border-cyan-400/90 bg-cyan-950/80 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.6)]'
            : 'border border-cyan-500/30 bg-cyan-950/30 text-cyan-400/80 group-hover:border-cyan-400/60 group-hover:text-cyan-300'
        }`}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="6" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </span>
    );
  }

  const iconClass = `h-[18px] w-[18px] shrink-0 transition-colors ${
    isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
  }`;

  switch (icon) {
    case 'games':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case 'research':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case 'favorites':
    case 'picks':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'matchups':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'ev':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case 'performance':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 3 5-7" />
        </svg>
      );
    case 'settings':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}

interface AppSidebarProps {
  currentPath: string;
  footer?: React.ReactNode;
}

export function AppSidebar({ currentPath, footer }: AppSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Reference sidebar approved list:
  // DeepSide AI, Games, Research Lab, AI Favorites, Best +EV Plays, Settings
  const sidebarItems: { label: string; href: string }[] = [
    { label: 'DeepSide AI', href: '/ai' },
    { label: 'Games', href: '/dashboard' },
    { label: 'Research Lab', href: '/research' },
    { label: 'AI Favorites', href: '/picks' },
    { label: 'Best +EV Plays', href: '/ai?query=Best+%2BEV+Plays' },
    { label: 'Settings', href: '/settings' },
    { label: 'System Health', href: '/system-health' },
  ];

  return (
    <>
      {/* Mobile Hamburger Button matching reference top-right */}
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="fixed right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#060d1b]/90 text-slate-300 shadow-lg backdrop-blur-md transition hover:border-cyan-500/40 hover:text-white md:hidden"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {/* Backdrop */}
      {isOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
        />
      ) : null}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[214px] shrink-0 flex-col border-r border-white/[0.07] bg-[#030612]/95 backdrop-blur-xl transition-transform duration-200 ease-out md:relative md:z-auto md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
          <Link href="/ai" onClick={() => setIsOpen(false)} className="block w-full">
            <DeepSideLogo size="sm" showTagline taglineClassName="tracking-[0.16em] text-[7px]" />
          </Link>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white md:hidden"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Navigation Items matching reference */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-2.5 py-4">
          {sidebarItems.map(({ label, href }) => {
            const icon = NAV_MAP[label] ?? 'ai';
            const isDeepSideAI = icon === 'ai';
            const isActive = isDeepSideAI
              ? currentPath === '/ai' || currentPath === '/'
              : currentPath === href || (href !== '/dashboard' && href !== '/ai?query=Best+%2BEV+Plays' && currentPath.startsWith(href));

            if (isActive && isDeepSideAI) {
              return (
                <Link
                  key={label}
                  href={href}
                  onClick={() => setIsOpen(false)}
                  className="group relative flex items-center gap-3 rounded-2xl border border-[#00b4d8]/80 bg-gradient-to-r from-[#0d2246] to-[#071329] px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-[0_0_18px_rgba(0,180,216,0.35),inset_0_0_10px_rgba(0,180,216,0.12)] transition"
                >
                  <NavItemIcon icon={icon} isActive={true} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            }

            return (
              <Link
                key={label}
                href={href}
                onClick={() => setIsOpen(false)}
                className={`group relative flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-[13px] font-medium tracking-tight transition duration-150 ${
                  isActive
                    ? 'border-white/10 bg-white/[0.06] text-white'
                    : 'text-slate-400 hover:border-white/5 hover:bg-white/[0.03] hover:text-white'
                }`}
              >
                <NavItemIcon icon={icon} isActive={isActive} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Account at bottom matching reference */}
        <div className="border-t border-white/[0.06] p-3">
          <Link
            href="/account"
            onClick={() => setIsOpen(false)}
            className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:border-white/5 hover:bg-white/[0.03] hover:text-white"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-600/40 bg-white/5 text-slate-300 group-hover:border-cyan-400/50 group-hover:text-cyan-300">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="truncate">Account</span>
          </Link>
        </div>

        {footer}
      </aside>
    </>
  );
}
