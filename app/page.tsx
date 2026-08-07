

const features = [
  {
    title: "AI Pick Analysis",
    description: "Evaluate every pick with AI-generated context, edge scores, and confidence signals.",
  },
  {
    title: "Player Trends",
    description: "Track recent performance, matchup history, and role-based momentum in one place.",
  },
  {
    title: "Matchup Research",
    description: "Break down team styles, pace, injuries, and situational factors instantly.",
  },
  {
    title: "Live Odds",
    description: "Compare market movement, value opportunities, and projected edges in real time.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#07111f_50%,_#030712_100%)] text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 py-6">
          <a href="#" className="text-xl font-semibold tracking-tight text-white">
            Sports Engineers
          </a>

          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:gap-6">
            <a href="#" className="transition hover:text-emerald-400">
              Dashboard
            </a>
            <a href="#" className="transition hover:text-emerald-400">
              Research
            </a>
            <a href="#" className="transition hover:text-emerald-400">
              Picks
            </a>
            <a href="#" className="transition hover:text-emerald-400">
              Pricing
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-400">
              Login
            </button>
            <button className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
              Get Started
            </button>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
              AI-powered sports betting research
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Make Smarter Sports Picks.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300 sm:text-xl">
              Research player props, matchups, trends, injuries, odds, and AI insights in one streamlined workspace built for sharper decisions.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
                Start Researching
              </button>
              <button className="rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-emerald-500 hover:text-emerald-400">
                View Dashboard
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6 shadow-2xl shadow-emerald-950/20 backdrop-blur sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <p className="text-sm text-slate-400">Today’s edge</p>
                <p className="text-xl font-semibold text-white">+8.2% projected value</p>
              </div>
              <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-300">
                Live
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Top trend</p>
                <p className="mt-1 font-medium text-white">Over 42.5 in high-variance matchup</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Injury watch</p>
                <p className="mt-1 font-medium text-white">Starter status updated 14 min ago</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">AI signal</p>
                <p className="mt-1 font-medium text-white">Momentum and market mismatch aligned</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 pb-16 sm:grid-cols-2 xl:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30"
            >
              <div className="mb-4 h-10 w-10 rounded-full bg-emerald-500/15" />
              <h2 className="text-lg font-semibold text-white">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{feature.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
