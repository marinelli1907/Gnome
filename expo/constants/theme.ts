// Gnome design tokens — "Market Architecture v2" §22 source of truth.
// Established now so future screens (full visual polish lands in M5) pull from
// one place. Existing screens keep using constants/colors.ts until the M5 pass
// migrates them onto these tokens.
//
// NOTE: hex values are the current best interpretation of the v2 palette names
// and should be confirmed against the design file during M5.

// Re-pointed to the v4 identity (docs/design/GNOME_IDENTITY.md). This export
// had ZERO live call sites but still held the pre-rebrand cream/green values —
// a loaded gun for the next person who imported it. It now mirrors
// constants/colors.ts; prefer importing Colors directly in new code.
export const palette = {
  primary: '#E32C27',    // Gnome Red (interactive cut — carries white text)
  secondary: '#43B649',  // Garden Green
  accent: '#FFC107',     // Harvest Yellow — charcoal text only, never white
  gold: '#FFC107',
  background: '#FFFFFF', // White canvas
  surface: '#FFFFFF',
  text: '#222222',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
} as const;

// Loaded via @expo-google-fonts/* in the root layout. Use these family names
// in styles (RN custom fonts don't respond to fontWeight, so pick the family).
// display* = Fraunces serif — the editorial voice from the Rork design pass —
// for headings and card titles; Inter stays the body face.
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  displayBlack: 'Fraunces_900Black',
} as const;

export const typography = {
  fontFamily: 'Inter',
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
