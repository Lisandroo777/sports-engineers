'use client';

import React from 'react';

export function FuturisticBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#02040a]"
    >
      {/* ── Base Dark Navy & Vignette ── */}
      <div className="absolute inset-0 bg-[#02040a]" />

      {/* ── Layered Angular Panels (Geometric Facets) ── */}
      <svg
        className="absolute inset-0 h-full w-full opacity-45"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        viewBox="0 0 1600 1000"
      >
        <defs>
          <linearGradient id="panel-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0b1b36" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#040b17" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#020409" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="panel-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1406" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#090f1d" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#02040a" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="wire-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#0284c7" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wire-gold" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#eab308" stopOpacity="0.4" />
            <stop offset="40%" stopColor="#ca8a04" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#ca8a04" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Angular facets matching the reference image's panel structure */}
        <polygon points="500,0 1200,0 900,450 350,450" fill="url(#panel-grad-1)" />
        <polygon points="1100,0 1600,0 1600,600 1200,900 800,900" fill="url(#panel-grad-2)" />
        <polygon points="0,450 500,1000 0,1000" fill="url(#panel-grad-2)" />

        {/* Thin geometric angled wire lines */}
        <line x1="-100" y1="200" x2="800" y2="900" stroke="url(#wire-blue)" strokeWidth="1" />
        <line x1="200" y1="-50" x2="1200" y2="750" stroke="url(#wire-blue)" strokeWidth="1" strokeDasharray="6 12" opacity="0.6" />
        <line x1="500" y1="-100" x2="1550" y2="700" stroke="url(#wire-blue)" strokeWidth="1.2" />
        <line x1="-50" y1="750" x2="700" y2="150" stroke="url(#wire-gold)" strokeWidth="1" />
        <line x1="100" y1="950" x2="950" y2="250" stroke="url(#wire-gold)" strokeWidth="1.2" strokeDasharray="8 14" opacity="0.7" />
        <line x1="900" y1="950" x2="1500" y2="450" stroke="url(#wire-gold)" strokeWidth="1" opacity="0.5" />
      </svg>

      {/* ── Soft Ambient Glow Orbs ── */}
      <div className="absolute -right-20 -top-20 h-[580px] w-[580px] rounded-full bg-cyan-500/15 blur-[130px] filter" />
      <div className="absolute right-1/4 top-1/4 h-[420px] w-[420px] rounded-full bg-sky-600/12 blur-[140px] filter" />
      <div className="absolute -bottom-24 -left-20 h-[620px] w-[620px] rounded-full bg-amber-500/15 blur-[130px] filter" />
      <div className="absolute bottom-1/3 left-1/4 h-[380px] w-[380px] rounded-full bg-yellow-600/10 blur-[120px] filter" />
      <div className="absolute -bottom-24 -left-20 h-[560px] w-[560px] rounded-full bg-amber-500/12 blur-[130px] filter" />
      <div className="absolute bottom-1/3 left-1/4 h-[380px] w-[380px] rounded-full bg-yellow-600/8 blur-[120px] filter" />

      {/* ── Animated Diagonal Light Trails & Streaks ── */}
      <div className="futuristic-streak-container absolute inset-0">
        {/* Main Electric Blue Diagonal Trail */}
        <div className="deepside-streak-blue-main" />
        {/* Secondary Electric Blue Trail */}
        <div className="deepside-streak-blue-sub" />
        {/* Deep Blue Bottom Trail */}
        <div className="deepside-streak-blue-bottom" />

        {/* Main Metallic Gold Diagonal Trail */}
        <div className="deepside-streak-gold-main" />
        {/* Secondary Metallic Gold Accent Trail */}
        <div className="deepside-streak-gold-sub" />
      </div>

      {/* ── Golden Stardust & Particle Field (Bottom-Left / Center) ── */}
      <div className="deepside-stardust-field absolute bottom-0 left-0 h-[45%] w-[60%] sm:h-[50%] sm:w-[50%]">
        <svg
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 600 450"
          preserveAspectRatio="none"
        >
          <defs>
            <radialGradient id="star-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fde047" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Stardust particles concentrated near bottom-left matching reference */}
          <g className="deepside-particle-cluster">
            {/* Fine spark cluster */}
            <circle cx="80" cy="380" r="1.5" fill="#fef08a" opacity="0.8" />
            <circle cx="110" cy="360" r="1.2" fill="#fde047" opacity="0.6" />
            <circle cx="95" cy="410" r="2" fill="url(#star-glow)" />
            <circle cx="140" cy="390" r="1.5" fill="#fef08a" opacity="0.75" />
            <circle cx="160" cy="340" r="1.8" fill="url(#star-glow)" />
            <circle cx="130" cy="320" r="1.2" fill="#fbbf24" opacity="0.65" />
            <circle cx="190" cy="370" r="1.4" fill="#fef08a" opacity="0.8" />
            <circle cx="210" cy="330" r="2.2" fill="url(#star-glow)" />
            <circle cx="175" cy="420" r="1.2" fill="#fbbf24" opacity="0.5" />
            <circle cx="230" cy="400" r="1.6" fill="#fde047" opacity="0.7" />
            <circle cx="250" cy="360" r="1.3" fill="#fef08a" opacity="0.7" />
            <circle cx="220" cy="300" r="1.5" fill="#fef08a" opacity="0.6" />
            <circle cx="270" cy="320" r="1.8" fill="url(#star-glow)" />
            <circle cx="290" cy="370" r="1.2" fill="#fbbf24" opacity="0.5" />
            <circle cx="310" cy="290" r="1.6" fill="#fef08a" opacity="0.75" />
            <circle cx="330" cy="340" r="2" fill="url(#star-glow)" />
            <circle cx="280" cy="260" r="1.2" fill="#fbbf24" opacity="0.6" />
            <circle cx="350" cy="310" r="1.4" fill="#fef08a" opacity="0.7" />
            <circle cx="380" cy="350" r="1.6" fill="#fde047" opacity="0.65" />
            <circle cx="360" cy="250" r="2.2" fill="url(#star-glow)" />
            <circle cx="410" cy="300" r="1.5" fill="#fef08a" opacity="0.7" />
            <circle cx="430" cy="340" r="1.3" fill="#fbbf24" opacity="0.5" />
            <circle cx="400" cy="230" r="1.4" fill="#fef08a" opacity="0.6" />
            <circle cx="450" cy="270" r="1.8" fill="url(#star-glow)" />
            <circle cx="480" cy="320" r="1.2" fill="#fde047" opacity="0.5" />
            <circle cx="460" cy="210" r="1.6" fill="#fef08a" opacity="0.75" />
            <circle cx="510" cy="250" r="2" fill="url(#star-glow)" />
            <circle cx="530" cy="290" r="1.3" fill="#fbbf24" opacity="0.6" />
            <circle cx="500" cy="180" r="1.4" fill="#fef08a" opacity="0.5" />
            <circle cx="550" cy="220" r="1.7" fill="url(#star-glow)" />
            <circle cx="570" cy="260" r="1.2" fill="#fde047" opacity="0.5" />

            {/* Denser micro dust close to the corner */}
            <circle cx="45" cy="420" r="1" fill="#fbbf24" opacity="0.5" />
            <circle cx="65" cy="435" r="1.3" fill="#fef08a" opacity="0.7" />
            <circle cx="85" cy="445" r="1.1" fill="#fde047" opacity="0.6" />
            <circle cx="115" cy="430" r="1.4" fill="#fbbf24" opacity="0.55" />
            <circle cx="150" cy="440" r="1.2" fill="#fef08a" opacity="0.65" />
            <circle cx="180" cy="450" r="1" fill="#fde047" opacity="0.5" />
          </g>
        </svg>
      </div>

      {/* ── Vignette edge overlay for clean contrast ── */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(2,4,10,0.7)_100%)]" />
    </div>
  );
}
