// Gnome palette v5 — the semantic identity (docs/design/GNOME_IDENTITY.md).
//
// White canvas, charcoal type, and five hues that each carry ONE meaning:
//   purple = Gnome AI and brand personality   (AI owns purple; nothing else uses it)
//   green  = growing, selling, positive/success
//   blue   = community, Free listings, information
//   red    = Trade, attention, destructive/error
//   yellow = rewards, discovery, highlights
//
// WHAT CHANGED FROM v4, and why it is a re-point rather than a re-paint: the
// hues and their measured accessible cuts are unchanged — only the ROLES moved.
//   Sell  red   -> green   (selling is growing; green is the product's heart)
//   Free  green -> blue    (Free is a community act)
//   Trade blue  -> red     (trade is the high-energy exchange)
// Red is deliberately no longer the global brand colour. `primary` is now the
// green interactive cut, so the everyday chrome reads agricultural rather than
// urgent, and purple stays reserved so Gnome AI genuinely owns it.
//
// TWO TOKENS PER HUE, on purpose. The *brand* value is for fills, illustration
// and map pins — anything that is not text. The *interactive* value is a deeper
// cut of the same hue that carries a WHITE label at WCAG AA (measured, not
// assumed: green 4.51:1, blue 4.56:1, red 4.51:1, purple 5.87:1). White on the
// brand yellow measures 1.63:1 — effectively invisible — so yellow NEVER takes
// a white label; pair it with `text` (charcoal, 9.76:1 on this yellow).
//
// Key names are unchanged so all ~70 importers re-skin without an edit.
const Colors = {
  // Global action colour. Green interactive — carries white text at 4.51:1.
  // (v4 had this as red; see the header note.)
  primary: '#328736',
  primaryLight: '#43B649', // Garden Green brand — fills/art, NOT text on white
  primaryDark: '#215E24',

  secondary: '#8E44AD', // AI Purple — brand personality, Gnome AI
  secondaryLight: '#B07CC6',
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
  textOnPrimary: '#FFFFFF', // on `primary` (#328736): 4.51:1 ✓

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
  // they are the interactive cuts. Sell = green, Free = blue, Trade = red.
  free: '#1878CD',  // blue — community/give
  sell: '#328736',  // green — grow/sell
  trade: '#E32C27', // red — exchange

  shadow: 'rgba(17, 24, 39, 0.10)',
  overlay: 'rgba(17, 24, 39, 0.5)',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  // Default active tint. Individual tabs override this with their own semantic
  // colour in app/(tabs)/_layout.tsx — Ask AI is purple, the rest are green.
  tabBarActive: '#328736',
  tabBarInactive: '#6B7280', // neutral slate; inactive is never semantic

  cardShadow: 'rgba(17, 24, 39, 0.07)',

  // Gnome AI's room. Purple appears here and in the AI tab, nowhere else.
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
  aiPurpleInteractive: '#8E44AD', // already 5.87:1 with white
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
