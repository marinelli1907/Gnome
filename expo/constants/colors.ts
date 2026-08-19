// Gnome palette v4 — the colorful Gnome identity (docs/design/GNOME_IDENTITY.md).
//
// White canvas, charcoal type, and the five gnome hues carrying meaning:
// red = selling/Market/core brand, green = garden/growing, blue =
// trade/community, purple = Gnome AI, yellow = rewards/celebration.
//
// TWO TOKENS PER HUE, on purpose. The *brand* value is the exact color from
// the identity spec — for fills, illustration, map pins, and anything that is
// not text. The *interactive* value is a slightly deeper cut of the same hue
// that carries a WHITE label at WCAG AA (measured, not assumed: red 4.51:1,
// blue 4.56:1, green 4.51:1, purple 5.87:1). White text on the brand yellow
// measures 1.63:1 — effectively invisible — so yellow NEVER takes a white
// label; pair it with `text` (charcoal, 9.76:1 on this yellow).
//
// Key names are unchanged from v3 so all ~70 importers re-skin without an
// edit. Some legacy names (terracotta, moss, sky, plum, marigold) now hold
// their nearest new-identity hue; prefer the gnome* names in new code.
const Colors = {
  // Core brand — Gnome Red. `primary` is the interactive cut (white text ok);
  // `primaryLight` is the brand red for fills and art.
  primary: '#E32C27',
  primaryLight: '#E53935',
  primaryDark: '#B71C1C',

  secondary: '#43B649', // Garden Green (brand — fills/art, NOT text on white)
  secondaryLight: '#77C97B',
  accent: '#FFC107', // Harvest Yellow — charcoal text only, never white
  accentLight: '#FFD54F',

  background: '#FFFFFF', // White canvas
  backgroundSecondary: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  text: '#222222', // Charcoal — 15.9:1 on white
  textSecondary: '#6B7280', // Slate — 4.83:1 on white
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',
  textOnPrimary: '#FFFFFF', // on `primary` (#E32C27): 4.51:1 ✓

  border: '#E5E7EB',
  borderLight: '#F1F5F9',
  divider: '#F1F5F9',
  // Inputs need to read as tappable against white cards; slate carries the
  // 3:1 UI-component contrast that a hairline gray cannot.
  inputBorder: '#6B7280',

  // Status colors are chosen to PASS AS TEXT on white (the brand greens and
  // ambers do not), and color is never the only signal — every status ships
  // with its word or icon.
  success: '#328736',
  warning: '#B45309',
  error: '#C62828',
  info: '#1878CD',

  // Listing-type identity. These double as text labels and badge tints, so
  // they are the interactive cuts; map pins pair them with distinct glyphs.
  free: '#328736',  // green — give/grow
  sell: '#E32C27',  // red — market/sell
  trade: '#1878CD', // blue — trade/community

  shadow: 'rgba(17, 24, 39, 0.10)',
  overlay: 'rgba(17, 24, 39, 0.5)',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  tabBarActive: '#E32C27',
  tabBarInactive: '#6B7280',

  cardShadow: 'rgba(17, 24, 39, 0.07)',

  // Gnome AI is the purple-hat gnome's room.
  chatBubbleUser: '#8E44AD',
  chatBubbleAI: '#F1F5F9',
  chatBubbleUserText: '#FFFFFF', // 5.87:1 on AI Purple ✓
  chatBubbleAIText: '#222222',

  gold: '#FFC107', // Harvest Yellow
  goldLight: '#FFF3CD',
  freshGreen: '#328736',
  urgentOrange: '#F59E0B', // fills/icons only — 2.15:1 as text on white

  // The five gnome hues, by their real names — use these in new code.
  gnomeRed: '#E53935',
  gnomeRedInteractive: '#E32C27',
  gardenGreen: '#43B649',
  gardenGreenInteractive: '#328736',
  tradeBlue: '#1E88E5',
  tradeBlueInteractive: '#1878CD',
  aiPurple: '#8E44AD',
  harvestYellow: '#FFC107',

  // Legacy Rork names, re-pointed to their nearest new-identity hue so old
  // call sites keep compiling and stop leaking the parchment-era palette.
  terracotta: '#E53935',
  marigold: '#FFC107',
  moss: '#43B649',
  sky: '#1E88E5',
  plum: '#8E44AD',
};

export default Colors;
