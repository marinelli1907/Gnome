'use client';

// The header's nav links collapse below 900px (they don't fit next to the
// brand). Without this the whole site — Browse, Grow, Pricing, My Market,
// Account — was unreachable from a phone. This is the same destination list
// as the desktop row, in a sheet, plus the two CTAs so the header bar itself
// can stay down to Sell + menu on narrow screens.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from './auth';

const GROW = [
  { href: '/garden', emoji: '✨', title: 'Garden Planner', desc: 'Know what to plant, and when' },
  { href: '/seeds', emoji: '🌱', title: 'Seed Drop', desc: 'Seeds picked for your season' },
  { href: '/plots', emoji: '🧑‍🌾', title: 'Reserve a Plot', desc: 'Grow without the space' },
];

export default function MobileNav({ iosUrl }: { iosUrl: string }) {
  const pathname = usePathname() ?? '/';
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Only send focus back to the toggle when WE closed the sheet — not on the
  // first render, and not after a tap that navigated somewhere else.
  const wasOpen = useRef(false);

  // Navigating closes the sheet: every item in here is a link, and the app
  // router keeps the layout mounted, so nothing else would. The route change
  // owns focus from here — don't yank it back to the toggle.
  useEffect(() => {
    wasOpen.current = false;
    setOpen(false);
  }, [pathname]);

  // The toggle is display:none at ≥900px and the inline links come back, so an
  // open sheet would be a full-screen overlay with no visible way to close it
  // if the window grows (or a tablet rotates) across the breakpoint.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const check = () => {
      if (mq.matches) {
        wasOpen.current = false; // the toggle is hidden — nothing to restore to
        setOpen(false);
      }
    };
    // Both signals: matchMedia 'change' misses under some emulated/zoomed
    // viewports; the resize event always fires. The check is a boolean read.
    mq.addEventListener('change', check);
    window.addEventListener('resize', check);
    return () => {
      mq.removeEventListener('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) toggleRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // GnomeAssistant listens on window; document fires first — one Escape
        // press should close the top overlay only, not both.
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the sheet — behind it the page is inert to the eye,
      // so it should be inert to the keyboard too.
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        // The containment check matters on both branches: a tap on the panel's
        // dead space parks focus on <body>, and forward Tab from there would
        // otherwise walk into the page behind the modal.
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const isHere = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`nav-toggle-icon${open ? ' is-open' : ''}`} aria-hidden="true">
          <span /><span /><span />
        </span>
      </button>

      {/* Portalled to <body>: .site-header sets backdrop-filter, which makes it
          a containing block for fixed children — inside it the scrim is clipped
          to the header bar instead of covering the screen. */}
      {open && createPortal(
        <div className="mobile-nav-scrim" onClick={() => setOpen(false)}>
          <div
            id="mobile-nav"
            ref={panelRef}
            className="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            onClick={(e) => {
              e.stopPropagation();
              // Same-route taps don't change `pathname`, so the pathname effect
              // never fires — close on any link activation instead.
              if ((e.target as HTMLElement).closest('a[href]')) setOpen(false);
            }}
          >
            {/* A real close control inside the dialog: with aria-modal, the
                hamburger in the header is hidden from screen readers, and the
                scrim is a bare div VoiceOver never lands on. */}
            <button type="button" className="mn-close" aria-label="Close menu" onClick={() => setOpen(false)}>
              <span aria-hidden="true">✕</span>
            </button>
            <Link className={`mn-item${isHere('/browse') ? ' is-here' : ''}`} href="/browse">
              Browse
            </Link>

            <p className="mn-heading">Grow</p>
            {GROW.map((g) => (
              <Link key={g.href} className={`mn-item mn-sub${isHere(g.href) ? ' is-here' : ''}`} href={g.href}>
                <span className="mn-title">{g.emoji} {g.title}</span>
                <span className="mn-desc">{g.desc}</span>
              </Link>
            ))}

            <Link className={`mn-item${isHere('/pricing') ? ' is-here' : ''}`} href="/pricing">
              Pricing
            </Link>
            <Link className={`mn-item${isHere('/my') ? ' is-here' : ''}`} href="/my">
              My Market
            </Link>
            {/* Matches AuthNavLink: "Account" once there's a session. */}
            <a className={`mn-item${isHere('/login') ? ' is-here' : ''}`} href="/login">
              {ready && session ? 'Account' : 'Sign in'}
            </a>

            <div className="mn-ctas">
              <Link className="btn btn-primary" href="/sell">Sell what you grow</Link>
              <a className="btn btn-secondary" href={iosUrl}>Get the app</a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
