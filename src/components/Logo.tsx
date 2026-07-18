import React from 'react';

// MoeAZack Valorant Tracker mark — an angular tactical emblem with a crosshair core.
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="MoeAZack Valorant Tracker logo">
      <defs>
        <linearGradient id="mzGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a83" />
          <stop offset="0.45" stopColor="#ff4655" />
          <stop offset="1" stopColor="#a8172a" />
        </linearGradient>
        <filter id="mzGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Angular tactical shield */}
      <path d="M50 4 L90 22 L83 61 L50 96 L17 61 L10 22 Z" fill="url(#mzGrad)" filter="url(#mzGlow)" />
      {/* Beveled top highlight */}
      <path d="M50 4 L90 22 L50 34 L10 22 Z" fill="#ffffff" opacity="0.14" />
      {/* Inner spike / negative peak */}
      <path d="M50 24 L70 41 L50 78 L30 41 Z" fill="#0F1923" opacity="0.92" />
      {/* Crosshair */}
      <circle cx="50" cy="47" r="5" fill="none" stroke="#ff4655" strokeWidth="3" />
      <line x1="50" y1="30" x2="50" y2="40" stroke="#ff4655" strokeWidth="3" strokeLinecap="round" />
      <line x1="50" y1="54" x2="50" y2="64" stroke="#ff4655" strokeWidth="3" strokeLinecap="round" />
      <line x1="37" y1="47" x2="43" y2="47" stroke="#ff4655" strokeWidth="3" strokeLinecap="round" />
      <line x1="57" y1="47" x2="63" y2="47" stroke="#ff4655" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
