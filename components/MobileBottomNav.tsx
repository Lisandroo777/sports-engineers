'use client';

import Link from 'next/link';

interface MobileBottomNavProps {
  currentPath: string;
}

export function MobileBottomNav({ currentPath }: MobileBottomNavProps) {
  const items = [
    { label: 'DeepSide AI', href: '/ai', icon: 'ai' },
    { label: 'Games', href: '/dashboard', icon: 'games' },
    { label: 'Research Lab', href: '/research', icon: 'research' },
    { label: 'Favorites', href: '/picks', icon: 'favorites' },
    { label: 'Best +EV Plays', href: '/ai?query=Best+%2BEV+Plays', icon: 'ev' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-white/[0.08] bg-[#030612]/95 px-1 py-1.5 backdrop-blur-xl md:hidden"
    >
      {items.map(({ label, href, icon }) => {
        const isAI = icon === 'ai';
        const isActive = isAI
          ? currentPath === '/ai' || currentPath === '/'
          : currentPath === href || (href !== '/dashboard' && currentPath.startsWith(href));

        return (
          <Link
            key={label}
            href={href}
            className={`flex flex-1 flex-col items-center justify-center py-1 transition-all ${
              isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {isAI ? (
              <span
                className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                  isActive
                    ? 'border border-cyan-400 bg-cyan-950/90 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.7)]'
                    : 'border border-cyan-500/30 bg-cyan-950/30 text-cyan-400/70'
                }`}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="6" />
                  <line x1="12" y1="2" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="5" y2="12" />
                  <line x1="19" y1="12" x2="22" y2="12" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </span>
            ) : icon === 'games' ? (
              <svg className="mb-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            ) : icon === 'research' ? (
              <svg className="mb-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            ) : icon === 'favorites' ? (
              <svg className="mb-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            ) : icon === 'ev' ? (
              <svg className="mb-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            ) : (
              <svg className="mb-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
            <span className="truncate max-w-full text-[8px] sm:text-[9px] font-medium leading-none tracking-tighter">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
