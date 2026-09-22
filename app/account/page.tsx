'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { DeepSideLogo } from '../../components/DeepSideLogo';
import { membershipPlans, sessions, usage, user } from './mockData';

export default function AccountPage() {
  const [profile, setProfile] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
  });
  const [selectedPlan, setSelectedPlan] = useState(user.plan);
  const [savedMessage, setSavedMessage] = useState(false);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavedMessage(true);
    window.setTimeout(() => setSavedMessage(false), 1400);
  };

  const activePlanLabel = selectedPlan === 'Pro' ? 'DeepSide Pro' : selectedPlan;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#07111f_50%,_#030712_100%)] text-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6 lg:py-6">
        <aside className="w-full shrink-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 lg:w-64">
          <div className="flex items-center justify-center">
            <DeepSideLogo className="h-auto w-[150px] max-w-full object-contain" />
          </div>

          <nav className="mt-6 space-y-1.5 text-sm">
            {[
              ['Dashboard', '/dashboard'],
              ['Research', '/research'],
              ['Picks', '/picks'],
              ['Matchups', '/matchups'],
              ['Account', '/account'],
              ['Settings', '/settings'],
            ].map(([label, href]) => (
              <Link key={label} href={href} className={`flex rounded-xl px-3 py-2 transition ${href === '/account' ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        <section className="flex-1 space-y-4">
          <header className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Account</p>
                <h1 className="text-xl font-semibold text-white">Manage your profile and plan</h1>
              </div>
              <Link href="/account" className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300">Account Settings</Link>
            </div>
          </header>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-lg font-semibold text-emerald-300">{user.avatar}</div>
                <div>
                  <p className="text-lg font-semibold text-white">{profile.firstName} {profile.lastName}</p>
                  <p className="text-sm text-slate-400">{profile.email}</p>
                  <p className="mt-1 text-sm text-emerald-300">{activePlanLabel}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Member since</p>
                <p className="mt-1 font-medium text-white">{user.memberSince}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-col gap-4 xl:flex-row">
              <form onSubmit={handleSave} className="flex-1 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">First Name</span>
                    <input value={profile.firstName} onChange={(event) => setProfile((current) => ({ ...current, firstName: event.target.value }))} className="w-full bg-transparent outline-none" />
                  </label>
                  <label className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Last Name</span>
                    <input value={profile.lastName} onChange={(event) => setProfile((current) => ({ ...current, lastName: event.target.value }))} className="w-full bg-transparent outline-none" />
                  </label>
                  <label className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Username</span>
                    <input value={profile.username} onChange={(event) => setProfile((current) => ({ ...current, username: event.target.value }))} className="w-full bg-transparent outline-none" />
                  </label>
                  <label className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Email</span>
                    <input value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} className="w-full bg-transparent outline-none" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">Save Changes</button>
                  {savedMessage ? <span className="text-sm text-emerald-300">Profile updated locally.</span> : null}
                </div>
              </form>

              <div className="w-full xl:max-w-sm">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Usage</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      ['Saved Picks', usage.savedPicks],
                      ['Active Alerts', usage.activeAlerts],
                      ['Research Views', usage.researchViews],
                      ['Tracked Players', usage.trackedPlayers],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Membership</p>
                <h2 className="text-lg font-semibold text-white">Choose a mock plan</h2>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {membershipPlans.map((plan) => (
                <div key={plan.name} className={`rounded-2xl border p-3 ${selectedPlan === plan.name ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{plan.name}</p>
                    {plan.highlight ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-300">Popular</span> : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{plan.description}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{plan.price}</p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-300">
                    {plan.features.map((feature) => <li key={feature}>• {feature}</li>)}
                  </ul>
                  <button onClick={() => setSelectedPlan(plan.name)} className="mt-4 rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300">Select {plan.name}</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Sessions</p>
                <h2 className="text-lg font-semibold text-white">Active devices</h2>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {sessions.map((session) => (
                <div key={session.device} className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{session.device}</p>
                    <p className="text-sm text-slate-400">{session.location}</p>
                  </div>
                  <div className="text-sm text-slate-400">{session.lastActive}</div>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
