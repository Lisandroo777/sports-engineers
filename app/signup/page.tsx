'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { DeepSideLogo } from '../../components/DeepSideLogo';

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Please complete all required fields.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      setError('Password should be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!agreed) {
      setError('Please agree to the Terms and Privacy Policy.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    window.setTimeout(() => {
      setIsSubmitting(false);
      router.push('/dashboard');
    }, 300);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#07111f_50%,_#030712_100%)] px-4 py-10 text-slate-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl shadow-slate-950/40 sm:p-8">
          <div className="text-center">
            <DeepSideLogo className="mx-auto h-auto w-[220px] max-w-full object-contain" />
            <h1 className="mt-2 text-2xl font-semibold text-white">Join DeepSide</h1>
            <p className="mt-2 text-sm text-slate-400">Build your research workflow and stay ahead of market shifts.</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">First Name</span>
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="w-full bg-transparent outline-none" placeholder="Lisandro" />
              </label>
              <label className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Last Name</span>
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} className="w-full bg-transparent outline-none" placeholder="Rodrigues" />
              </label>
            </div>

            <label className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full bg-transparent outline-none" placeholder="you@example.com" />
            </label>

            <label className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
              <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.24em] text-slate-500">
                <span>Password</span>
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">{showPassword ? 'Hide' : 'Show'}</button>
              </span>
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent outline-none" placeholder="Create a password" />
            </label>

            <label className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-300">
              <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.24em] text-slate-500">
                <span>Confirm Password</span>
                <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">{showConfirmPassword ? 'Hide' : 'Show'}</button>
              </span>
              <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full bg-transparent outline-none" placeholder="Repeat your password" />
            </label>

            {password && confirmPassword && password !== confirmPassword ? <p className="text-sm text-amber-300">Password mismatch warning.</p> : null}

            <label className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-400">
              <input type="checkbox" checked={agreed} onChange={() => setAgreed((current) => !current)} className="mt-1 accent-emerald-500" />
              <span>I agree to the Terms and Privacy Policy.</span>
            </label>

            <button type="submit" disabled={isSubmitting} className="w-full rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70">
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 space-y-2">
            <button type="button" className="flex w-full items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300">Continue with Google</button>
            <button type="button" className="flex w-full items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300">Continue with Apple</button>
          </div>

          <div className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-emerald-300 transition hover:text-emerald-200">Sign In</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
