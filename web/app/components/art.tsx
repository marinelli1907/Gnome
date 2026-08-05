// Hand-drawn-style inline SVG art. Flat shapes, locked M5 palette only —
// no stock photos, no external assets, scales crisply everywhere.

const GREEN = '#1B4332';
const GREEN_LIGHT = '#2D6A4F';
const SAGE = '#87A96B';
const TOMATO = '#BC4749';
const GOLD = '#E9C46A';
const CREAM = '#FEFAE0';
const SURFACE = '#FFFDF8';
const SKIN = '#F2C6A0';
const NOSE = '#E5A87F';

/** The Gnome himself. Pointed hat, big beard, little boots. */
export function GnomeMascot({ size = 190, className = '' }: { size?: number; className?: string }) {
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
      <ellipse cx="50" cy="143" rx="12" ry="6" fill={GREEN} />
      <ellipse cx="80" cy="143" rx="12" ry="6" fill={GREEN} />
      {/* tunic */}
      <path d="M38 108 Q65 100 92 108 L96 138 Q65 146 34 138 Z" fill={SAGE} />
      {/* arms tucked — mitten holding a tomato */}
      <circle cx="97" cy="124" r="8" fill={SAGE} />
      <circle cx="103" cy="121" r="7.5" fill={TOMATO} />
      <path d="M103 114.5 q-1.5 -3 2 -4.5 q0.5 2.5 -2 4.5" fill={GREEN_LIGHT} />
      {/* beard */}
      <path
        d="M34 84 Q30 122 52 132 Q65 138 78 132 Q100 122 96 84 Q88 92 80 90 Q73 96 65 96 Q57 96 50 90 Q42 92 34 84 Z"
        fill={SURFACE}
        stroke="#E7E4D7"
        strokeWidth="1.5"
      />
      {/* face sliver + nose */}
      <path d="M44 78 Q65 92 86 78 Q80 88 65 89 Q50 88 44 78 Z" fill={SKIN} />
      <circle cx="65" cy="84" r="8.5" fill={NOSE} />
      {/* hat — tall, tip flops right */}
      <path
        d="M30 80 Q28 40 58 16 Q66 4 84 8 Q104 12 100 26 Q97 36 88 34 Q94 56 100 80 Q65 68 30 80 Z"
        fill={TOMATO}
      />
      {/* hat band */}
      <path d="M30 80 Q65 66 100 80 L98 87 Q65 74 32 87 Z" fill={GOLD} />
      {/* hat tip bobble */}
      <circle cx="98" cy="15" r="7" fill={GOLD} />
    </svg>
  );
}

/** Small gnome head for the header brand + footer. */
export function GnomeMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M14 50 Q12 62 32 62 Q52 62 50 50 Q44 55 38 53 Q32 57 26 53 Q20 55 14 50 Z" fill={SURFACE} stroke="#DAD7CD" strokeWidth="1.5" />
      <path d="M18 44 Q32 52 46 44 Q42 50 32 50 Q22 50 18 44 Z" fill={SKIN} />
      <circle cx="32" cy="47" r="5.5" fill={NOSE} />
      <path d="M12 46 Q12 20 30 8 Q36 2 46 6 Q56 10 52 18 Q50 24 44 22 Q48 34 52 46 Q32 38 12 46 Z" fill={TOMATO} />
      <path d="M12 46 Q32 38 52 46 L51 51 Q32 43 13 51 Z" fill={GOLD} />
    </svg>
  );
}

/** Leafy vine divider used above section headings. */
export function Vine({ className = '' }: { className?: string }) {
  const leaf = (x: number, y: number, flip = false) =>
    `M${x} ${y} q${flip ? -10 : 10} -2 ${flip ? -12 : 12} -10 q${flip ? 12 : -12} 0 ${flip ? 12 : -12} 10`;
  return (
    <svg className={className} width="220" height="26" viewBox="0 0 220 26" fill="none" aria-hidden>
      <path d="M4 18 Q56 4 110 16 Q164 28 216 12" stroke={SAGE} strokeWidth="2.5" strokeLinecap="round" />
      <path d={leaf(38, 14)} fill={GREEN_LIGHT} />
      <path d={leaf(96, 16, true)} fill={SAGE} />
      <path d={leaf(150, 20)} fill={GREEN_LIGHT} />
      <path d={leaf(196, 13, true)} fill={SAGE} />
      <circle cx="68" cy="12" r="3.5" fill={TOMATO} />
      <circle cx="176" cy="16" r="3.5" fill={GOLD} />
    </svg>
  );
}

/** Tiny sprout for list bullets / accents. */
export function Sprout({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21 V11" stroke={GREEN_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 12 Q12 4 4 4 Q4 12 12 12 Z" fill={SAGE} />
      <path d="M12 10 Q12 3 20 3 Q20 10 12 10 Z" fill={GREEN_LIGHT} />
      <ellipse cx="12" cy="21.5" rx="6" ry="2" fill={CREAM} />
    </svg>
  );
}

/** Sun with rays, for the hero corner. */
export function Sun({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 80 80" fill="none" aria-hidden>
      <circle cx="40" cy="40" r="16" fill={GOLD} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const x1 = 40 + Math.cos(a) * 23;
        const y1 = 40 + Math.sin(a) * 23;
        const x2 = 40 + Math.cos(a) * (i % 2 ? 30 : 34);
        const y2 = 40 + Math.sin(a) * (i % 2 ? 30 : 34);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
        );
      })}
    </svg>
  );
}
