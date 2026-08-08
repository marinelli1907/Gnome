// Gnome palette v3 — ported from the Rork design pass Daniel preferred
// (parchment + ink + terracotta, serif display type). Raw HSL tokens live in
// the Rork prototype's src/index.css; converted to hex here.
const Colors = {
  primary: '#1F3D2E', // Deep Garden Green (ink-green)
  primaryLight: '#2E5943',
  primaryDark: '#152820',

  secondary: '#618049', // Moss
  secondaryLight: '#7FA065',
  accent: '#C6633A', // Terracotta
  accentLight: '#D98A66',

  background: '#F6F2E9', // Parchment
  backgroundSecondary: '#EBE6DA',
  surface: '#FBF8F3', // Card
  surfaceElevated: '#FFFFFF',

  text: '#152820', // Ink
  textSecondary: '#556D63', // Muted green-gray
  textTertiary: '#8A9689',
  textInverse: '#F8F5EC',
  textOnPrimary: '#F8F5EC',

  border: '#DCD5C6',
  borderLight: '#E7E1D3',
  divider: '#E7E1D3',

  success: '#517439',
  warning: '#DFA23A',
  error: '#BA352C',
  info: '#38728A',

  free: '#517439', // moss green
  sell: '#AE5832', // deep terracotta
  trade: '#38728A', // sky teal

  shadow: 'rgba(21, 40, 32, 0.10)',
  overlay: 'rgba(21, 40, 32, 0.5)',

  tabBar: '#FBF8F3',
  tabBarBorder: '#DCD5C6',
  tabBarActive: '#1F3D2E',
  tabBarInactive: '#8A9689',

  cardShadow: 'rgba(21, 40, 32, 0.07)',

  chatBubbleUser: '#1F3D2E',
  chatBubbleAI: '#EBE6DA',
  chatBubbleUserText: '#F8F5EC',
  chatBubbleAIText: '#152820',

  gold: '#DFA23A', // Marigold
  goldLight: '#F7EAC9',
  freshGreen: '#2E5943',
  urgentOrange: '#D98A66',

  // Rork accent set, available to new UI.
  terracotta: '#C6633A',
  marigold: '#DFA23A',
  moss: '#618049',
  sky: '#38728A',
  plum: '#6B538D',
};

export default Colors;
