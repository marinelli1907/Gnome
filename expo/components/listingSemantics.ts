// The SEMANTIC layer for the five listing types, sitting on top of the v4
// token flip in constants/colors.ts (docs/design/GNOME_IDENTITY.md §1).
//
// Why this file exists rather than an edit to lib/listingType.ts: `TYPE_COLOR`
// there is a single value per type, but a hue that is correct as a *fill* is
// often unreadable as a *label*, and the spec's answer is two tokens per hue —
// brand for fills/pins, interactive for anything that carries white text.
// Yellow never carries white text at all (1.63:1), so the Plot badge inverts to
// charcoal. One value per type cannot express that, so the presentation layer
// owns it here and lib/listingType.ts stays the data/ordering source of truth.
//
// NOTE for whoever owns lib/: TYPE_COLOR currently maps `plot` to Colors.primary
// — the same red as `sale` — so Plot pins and Plot badges are indistinguishable
// from Sell. That is the defect these maps correct. Folding these three maps
// back into lib/listingType.ts is the right long-term home.
import Colors from '@/constants/colors';
import type { ListingType } from '@/types';

/**
 * Map-pin fill. BRAND cuts, not interactive cuts: a pin is a graphic, it never
 * carries a label, and on Android react-native-maps keeps only the HUE of this
 * colour (`Color.colorToHSV` -> `BitmapDescriptorFactory.defaultMarker`), so
 * the value has to sit unambiguously inside its hue family.
 *
 * Measured hue angle per value, so the Android snap is predictable:
 *   sale   #E53935 ->   1deg  red
 *   free   #43B649 -> 123deg  green
 *   trade  #1E88E5 -> 208deg  azure/blue
 *   wanted #8E44AD -> 282deg  violet
 *   plot   #FFC107 ->  45deg  amber/yellow
 *
 * Colour is not the only signal here: tapping a pin opens the listing card,
 * which carries the type WORD via TypeBadge (identity spec §1b).
 */
export const PIN_COLOR: Record<ListingType, string> = {
  sale: Colors.gnomeRed,
  free: Colors.gardenGreen,
  trade: Colors.tradeBlue,
  wanted: Colors.plum,
  plot: Colors.harvestYellow,
};

/**
 * Solid badge fill. INTERACTIVE cuts for the four hues that take a white
 * label; Harvest Yellow keeps its brand value because its label is charcoal.
 */
export const TYPE_BADGE_BG: Record<ListingType, string> = {
  sale: Colors.gnomeRedInteractive,
  free: Colors.gardenGreenInteractive,
  trade: Colors.tradeBlueInteractive,
  wanted: Colors.aiPurple,
  plot: Colors.harvestYellow,
};

/**
 * Badge label colour, measured against the fill above (WCAG 2.1, AA body 4.5:1
 * — the badge label is 11px bold, which is NOT "large text", so 4.5:1 applies):
 *   white on #E32C27 -> 4.51:1
 *   white on #328736 -> 4.51:1
 *   white on #1878CD -> 4.56:1
 *   white on #8E44AD -> 5.87:1
 *   charcoal #222222 on #FFC107 -> 9.76:1   (white on it would be 1.63:1)
 */
export const TYPE_BADGE_FG: Record<ListingType, string> = {
  sale: Colors.textInverse,
  free: Colors.textInverse,
  trade: Colors.textInverse,
  wanted: Colors.textInverse,
  plot: Colors.text,
};
