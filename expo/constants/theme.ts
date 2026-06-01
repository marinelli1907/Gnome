// Gnome design tokens — "Market Architecture v2" §22 source of truth.
// Established now so future screens (full visual polish lands in M5) pull from
// one place. Existing screens keep using constants/colors.ts until the M5 pass
// migrates them onto these tokens.
//
// NOTE: hex values are the current best interpretation of the v2 palette names
// and should be confirmed against the design file during M5.

export const palette = {
  primary: '#1B4332', // Deep Garden Green
  secondary: '#87A96B', // Sage
  accent: '#BC4749', // Tomato Red
  gold: '#E9C46A', // Harvest Gold
  background: '#FEFAE0', // Warm Cream
  surface: '#FFFFFF',
  text: '#1B1B1B',
  textSecondary: '#5C5C5C',
  border: '#E8E2D0',
} as const;

export const typography = {
  fontFamily: 'Inter',
  // weights used across the app
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' },
  size: { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, '2xl': 24, '3xl': 30 },
} as const;

// 4-based spacing scale per v2.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 20 } as const;

export const theme = { palette, typography, spacing, radius } as const;
export default theme;
