'use client';

// Homepage "what's near me?" box — the visitor's first question. Routes to
// /browse?loc=..., where BrowseClient geocodes and persists the location.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logWeb } from '../../lib/analytics';

export default function HomeLocate() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function go() {
    const q = value.trim();
    logWeb('zip_search', { q: q || null });
    router.push(q ? `/browse?loc=${encodeURIComponent(q)}` : '/browse');
  }

  return (
    <div className="locate-box">
      <input
        value={value}
        inputMode="text"
        placeholder="ZIP code or town"
        aria-label="Your ZIP code or town"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
      />
      <button className="btn btn-primary" onClick={go}>
        See what’s growing
      </button>
    </div>
  );
}
