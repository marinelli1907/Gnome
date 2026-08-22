// Gnome palette v6 — the multicolour identity (docs/design/GNOME_IDENTITY.md).
//
// White canvas, charcoal type, and five hues that each carry ONE meaning:
//   purple = Gnome brand + Gnome AI      (the strongest recognisable accent)
//   green  = Sell, growing, success
//   blue   = Free, community, Map/navigation
//   red    = Trade, attention, destructive/error
//   orange = Market, harvest, Post/create
//   yellow = rewards, discovery, highlights
//
// v6 makes purple the BRAND colour and gives orange a real job. Before this,
// the app read as white+green — one hue doing brand, action and Sell at once.
// Now each does one thing, and white still occupies most of every screen: the
// colour lives in badges, selected states, icons and section accents, never in
// backgrounds. No gradients, no multi-colour buttons.
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
  // v6: PURPLE is the Gnome brand colour. It carries brand moments, Gnome AI
  // and brand-level actions — 5.87:1 with white, so it needs no deeper cut.
  // Green did NOT disappear; it moved to where it means something (Sell, grow,
  // success). Deliberately not every button: Post and Market are orange, the
  // listing types keep their own hues.
  primary: '#8E44AD',
  primaryLight: '#A569BD',
  primaryDark: '#6C3382',

  secondary: '#43B649', // Garden Green brand — grow/sell fills and art
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
  textOnPrimary: '#FFFFFF', // on `primary` (#8E44AD): 5.87:1 ✓

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
  // Default active tint (brand purple). Every tab overrides it with its own
  // semantic colour in app/(tabs)/_layout.tsx: Browse green, Map blue, Post
  // orange, Ask AI purple, Market orange, Profile purple. Inactive stays
  // neutral slate so the bar reads as one product, not six.
  tabBarActive: '#8E44AD',
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
  // Market / harvest / warmth. The brand cut is a fill and NEVER takes a white
  // label (2.93:1 — measured); pair it with `text`. The interactive cut is the
  // one that carries white, at 5.18:1.
  marketOrange: '#F4700A',
  marketOrangeInteractive: '#C2410C',
  onOrange: '#222222', // charcoal on brand orange — 5.43:1

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
