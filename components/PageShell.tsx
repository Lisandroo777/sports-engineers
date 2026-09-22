import { AppSidebar } from './AppSidebar';

interface PageShellProps {
  currentPath: string;
  title: string;
  subtitle?: string;
  rightRail?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function PageShell({ currentPath, title, subtitle, rightRail, children, action }: PageShellProps) {
  return (
    <div className="flex min-h-screen bg-[var(--se-bg)] text-[var(--se-text)]">
      <AppSidebar currentPath={currentPath} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto px-5 py-5">
          <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-[var(--se-muted)]">{subtitle}</p> : null}
            </div>
            {action ? <div className="flex items-center gap-2">{action}</div> : null}
          </header>

          <div className="flex flex-col gap-5 2xl:flex-row">
            <div className="flex-1 space-y-5">{children}</div>
            {rightRail ? <div className="w-full shrink-0 space-y-4 2xl:w-[280px]">{rightRail}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
