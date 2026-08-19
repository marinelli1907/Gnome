// Hand-drawn-style inline SVG art. Flat shapes, identity v4 palette only —
// no stock photos, no external assets, scales crisply everywhere.
//
// ONE GNOME FAMILY (GNOME_IDENTITY.md §2): same silhouette, same proportions,
// same line weight. Only the HAT colour and the prop change, so the five read
// as five members of one household rather than five stock illustrations.
// Red owns Market & Sell and is the default; green owns Garden & Grow, blue
// Trade & Community, purple Gnome AI, yellow Rewards & Discovery.
//
// These are art fills, so they use the BRAND cut of each hue, never the
// interactive one — nothing here is text and nothing here carries meaning on
// its own (§1b: the hue is always paired with a word elsewhere on the page).

const RED = '#E53935';          // Gnome Red — core brand
const GREEN = '#43B649';        // Garden Green
const GREEN_DEEP = '#215E24';   // boots / stems: the deep cut, for weight
const BLUE = '#1E88E5';         // Trade Blue
const PURPLE = '#8E44AD';       // AI Purple
const YELLOW = '#FFC107';       // Harvest Yellow
const SURFACE = '#FFFFFF';      // beard, on the white canvas
const BEARD_LINE = '#E5E7EB';   // the beard needs an outline on white
const SKIN = '#F2C6A0';
const NOSE = '#E5A87F';

/** The five hats. `hue` is additive — every existing call site keeps the red
 *  gnome, and new surfaces can ask for the one that owns their meaning. */
export type GnomeHue = 'red' | 'green' | 'blue' | 'purple' | 'yellow';
const HAT: Record<GnomeHue, string> = {
  red: RED, green: GREEN, blue: BLUE, purple: PURPLE, yellow: YELLOW,
};

/** The Gnome himself. Pointed hat, big beard, little boots. */
export function GnomeMascot({ size = 190, className = '', hue = 'red' }: { size?: number; className?: string; hue?: GnomeHue }) {
  return (
    <svg
      className={className}
      width={size}
      height={size * (150 / 130)}
      viewBox="0 0 130 150"
      fill="none"
      aria-hidden
    >
      {/* boots */}
      <ellipse cx="50" cy="143" rx="12" ry="6" fill={GREEN_DEEP} />
      <ellipse cx="80" cy="143" rx="12" ry="6" fill={GREEN_DEEP} />
      {/* tunic */}
      <path d="M38 108 Q65 100 92 108 L96 138 Q65 146 34 138 Z" fill={GREEN} />
      {/* arms tucked — mitten holding a tomato */}
      <circle cx="97" cy="124" r="8" fill={GREEN} />
      <circle cx="103" cy="121" r="7.5" fill={RED} />
      <path d="M103 114.5 q-1.5 -3 2 -4.5 q0.5 2.5 -2 4.5" fill={GREEN_DEEP} />
      {/* beard */}
      <path
        d="M34 84 Q30 122 52 132 Q65 138 78 132 Q100 122 96 84 Q88 92 80 90 Q73 96 65 96 Q57 96 50 90 Q42 92 34 84 Z"
        fill={SURFACE}
        stroke={BEARD_LINE}
        strokeWidth="1.5"
      />
      {/* face sliver + nose */}
      <path d="M44 78 Q65 92 86 78 Q80 88 65 89 Q50 88 44 78 Z" fill={SKIN} />
      <circle cx="65" cy="84" r="8.5" fill={NOSE} />
      {/* hat — tall, tip flops right */}
      <path
        d="M30 80 Q28 40 58 16 Q66 4 84 8 Q104 12 100 26 Q97 36 88 34 Q94 56 100 80 Q65 68 30 80 Z"
        fill={HAT[hue]}
      />
      {/* hat band */}
      <path d="M30 80 Q65 66 100 80 L98 87 Q65 74 32 87 Z" fill={hue === 'yellow' ? RED : YELLOW} />
      {/* hat tip bobble */}
      <circle cx="98" cy="15" r="7" fill={hue === 'yellow' ? RED : YELLOW} />
    </svg>
  );
}

/** Small gnome head for the header brand + footer. */
export function GnomeMark({ size = 28, className = '', hue = 'red' }: { size?: number; className?: string; hue?: GnomeHue }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M14 50 Q12 62 32 62 Q52 62 50 50 Q44 55 38 53 Q32 57 26 53 Q20 55 14 50 Z" fill={SURFACE} stroke={BEARD_LINE} strokeWidth="1.5" />
      <path d="M18 44 Q32 52 46 44 Q42 50 32 50 Q22 50 18 44 Z" fill={SKIN} />
      <circle cx="32" cy="47" r="5.5" fill={NOSE} />
      <path d="M12 46 Q12 20 30 8 Q36 2 46 6 Q56 10 52 18 Q50 24 44 22 Q48 34 52 46 Q32 38 12 46 Z" fill={HAT[hue]} />
      <path d="M12 46 Q32 38 52 46 L51 51 Q32 43 13 51 Z" fill={hue === 'yellow' ? RED : YELLOW} />
    </svg>
  );
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
