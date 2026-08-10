/**
 * Rough USDA hardiness zone from a US ZIP code.
 *
 * Mirrors the web app's derivation so the Garden Planner and profile agree.
 * This is an approximation from ZIP-prefix latitude bands — good enough to
 * pre-fill a suggestion, never presented as authoritative. Returns null when
 * the ZIP isn't a plausible 5-digit US code.
 */
const ZONE_BY_PREFIX: Record<string, string> = {
  // New England / upper Midwest / northern plains (cold)
  '03': '5', '04': '4', '05': '4', '54': '4', '55': '4', '56': '3', '57': '4', '58': '3', '59': '4',
  // Mid-Atlantic / Great Lakes
  '01': '6', '02': '6', '06': '6', '07': '7', '08': '7', '10': '7', '11': '7', '12': '5',
  '13': '5', '14': '6', '15': '6', '16': '6', '17': '6', '18': '6', '19': '7',
  '43': '6', '44': '6', '45': '6', '46': '5', '47': '6', '48': '6', '49': '5',
  '50': '5', '51': '5', '52': '5', '53': '5', '60': '5', '61': '5', '62': '6',
  // Upper South / Appalachia
  '20': '7', '21': '7', '22': '7', '23': '7', '24': '6', '25': '6', '26': '6',
  '27': '7', '28': '7', '29': '8', '37': '7', '38': '7', '40': '6', '41': '6', '42': '6',
  // Deep South / Gulf
  '30': '8', '31': '8', '32': '9', '33': '10', '34': '10', '35': '8', '36': '8', '39': '8',
  '70': '9', '71': '8', '72': '7', '73': '7', '74': '7', '75': '8', '76': '8', '77': '9',
  '78': '9', '79': '7',
  // Mountain / Southwest
  '80': '5', '81': '5', '82': '4', '83': '5', '84': '6', '85': '9', '86': '6', '87': '6',
  '88': '7', '89': '8',
  // West Coast / Pacific
  '90': '10', '91': '9', '92': '10', '93': '9', '94': '9', '95': '9', '96': '9',
  '97': '8', '98': '8', '99': '5',
};

export function hardinessZoneForZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const clean = zip.trim();
  if (!/^\d{5}$/.test(clean)) return null;
  return ZONE_BY_PREFIX[clean.slice(0, 2)] ?? null;
}
