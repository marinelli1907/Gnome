// Hand-drawn-style inline SVG art. Flat shapes, identity v6 palette only —
// no stock photos, no external assets, scales crisply everywhere.
//
// ONE GNOME FAMILY (GNOME_IDENTITY.md §2): same silhouette, same proportions,
// same line weight. Purple is the default brand hat; other hues are opt-in
// semantic variants for surfaces that already say what they mean in text.
//
// These are art fills, so they use the BRAND cut of each hue, never the
// interactive one — nothing here is text and nothing here carries meaning on
// its own (§1b: the hue is always paired with a word elsewhere on the page).

const CHARCOAL = '#24211D';
const RED = '#E53935';          // Trade / attention
const GREEN = '#43B649';        // Garden Green
const GREEN_DEEP = '#215E24';   // boots / stems: the deep cut, for weight
const BLUE = '#1E88E5';         // Free / map / community
const PURPLE = '#6B2FB9';       // Gnome Purple — brand / AI
const PURPLE_DARK = '#5A249B';
const YELLOW = '#FFC107';       // Harvest Yellow
const SURFACE = '#FFFFFF';      // beard, on the white canvas
const SKIN = '#F2C6A0';

/** The five hats. `hue` is additive; brand surfaces keep the purple gnome. */
export type GnomeHue = 'red' | 'green' | 'blue' | 'purple' | 'yellow';
const HAT: Record<GnomeHue, string> = {
  red: RED, green: GREEN, blue: BLUE, purple: PURPLE, yellow: YELLOW,
};

function GnomeHead({ size, className, hue }: { size: number; className?: string; hue: GnomeHue }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden
    >
      <path
        d="M176 539c22-181 83-329 182-443 49-57 134-62 201-10 86 67 126 182 126 326 55 19 109 56 162 111-188-56-482-51-671 16z"
        fill={HAT[hue]}
        stroke={CHARCOAL}
        strokeWidth="36"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M156 559c96-75 246-113 356-113 117 0 268 38 356 113-40 76-161 77-256 26-23 46-60 70-100 70s-77-24-100-70c-95 51-216 50-256-26z"
        fill={hue === 'purple' ? PURPLE_DARK : HAT[hue]}
        stroke={CHARCOAL}
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M190 579c24 78 82 121 157 123-26 80 13 156 108 182 26 7 45 37 57 79 12-42 31-72 57-79 95-26 134-102 108-182 75-2 133-45 157-123-80 43-159 45-234 7-19 45-51 74-88 74s-69-29-88-74c-75 38-154 36-234-7z"
        fill={SURFACE}
        stroke={CHARCOAL}
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M245 648c22 70 67 110 126 121-12-46 1-89 41-130-55 32-110 35-167 9z"
        fill={SURFACE}
        stroke={CHARCOAL}
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M779 648c-22 70-67 110-126 121 12-46-1-89-41-130 55 32 110 35 167 9z"
        fill={SURFACE}
        stroke={CHARCOAL}
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M445 577c0 39 30 68 67 68s67-29 67-68-30-68-67-68-67 29-67 68z" fill={SKIN} stroke={CHARCOAL} strokeWidth="34" />
      <path d="M381 344c-83-3-131 50-121 127 76 15 133-25 121-127z" fill={GREEN} stroke={CHARCOAL} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M381 344c6-91 73-142 158-119 3 92-60 148-158 119z" fill="#6ECF4A" stroke={CHARCOAL} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M309 449c53-45 115-81 181-110" stroke={GREEN_DEEP} strokeWidth="16" strokeLinecap="round" />
      <path d="M198 548c146-64 444-89 668 4" stroke={SURFACE} strokeWidth="18" strokeLinecap="round" opacity=".92" />
    </svg>
  );
}

/** The Gnome himself: brand mark, used large in hero and assistant surfaces. */
export function GnomeMascot({ size = 190, className = '', hue = 'purple' }: { size?: number; className?: string; hue?: GnomeHue }) {
  return <GnomeHead size={size} className={className} hue={hue} />;
}

/** Small gnome head for the header brand + footer. */
export function GnomeMark({ size = 28, className = '', hue = 'purple' }: { size?: number; className?: string; hue?: GnomeHue }) {
  return <GnomeHead size={size} className={className} hue={hue} />;
}

/** Leafy vine divider used above section headings. */
export function Vine({ className = '' }: { className?: string }) {
  const leaf = (x: number, y: number, flip = false) =>
    `M${x} ${y} q${flip ? -10 : 10} -2 ${flip ? -12 : 12} -10 q${flip ? 12 : -12} 0 ${flip ? 12 : -12} 10`;
  return (
    <svg className={className} width="220" height="26" viewBox="0 0 220 26" fill="none" aria-hidden>
      <path d="M4 18 Q56 4 110 16 Q164 28 216 12" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" />
      <path d={leaf(38, 14)} fill={GREEN_DEEP} />
      <path d={leaf(96, 16, true)} fill={GREEN} />
      <path d={leaf(150, 20)} fill={GREEN_DEEP} />
      <path d={leaf(196, 13, true)} fill={GREEN} />
      <circle cx="68" cy="12" r="3.5" fill={RED} />
      <circle cx="176" cy="16" r="3.5" fill={YELLOW} />
    </svg>
  );
}

/** Tiny sprout for list bullets / accents. */
export function Sprout({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21 V11" stroke={GREEN_DEEP} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 12 Q12 4 4 4 Q4 12 12 12 Z" fill={GREEN} />
      <path d="M12 10 Q12 3 20 3 Q20 10 12 10 Z" fill={GREEN_DEEP} />
      <ellipse cx="12" cy="21.5" rx="6" ry="2" fill="#F1F5F9" />
    </svg>
  );
}

/** Sun with rays, for the hero corner. */
export function Sun({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 80 80" fill="none" aria-hidden>
      <circle cx="40" cy="40" r="16" fill={YELLOW} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const x1 = 40 + Math.cos(a) * 23;
        const y1 = 40 + Math.sin(a) * 23;
        const x2 = 40 + Math.cos(a) * (i % 2 ? 30 : 34);
        const y2 = 40 + Math.sin(a) * (i % 2 ? 30 : 34);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={YELLOW} strokeWidth="3" strokeLinecap="round" />
        );
      })}
    </svg>
  );
}
