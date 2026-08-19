// Market QR asset generation — pure helpers plus one canvas compositor.
//
// The QR always encodes the durable /q/<code> redirect, never the slug URL: the slug is readable
// and rename-safe today, but the redirect is what stays printable forever and what the scan
// ledger hangs off. The code itself is opaque — nothing sensitive can be in the image because
// nothing sensitive is in the URL.
import QRCode from 'qrcode';

export const QR_BASE = 'https://gnomefarmersmarket.com';

export function qrTargetUrl(code: string): string {
  return `${QR_BASE}/q/${code}`;
}

/**
 * Naked QR as an SVG string — vector, so print shops can scale it arbitrarily.
 * Error correction M: solid reliability with nothing drawn over the symbol.
 */
export function nakedQrSvg(code: string): Promise<string> {
  return QRCode.toString(qrTargetUrl(code), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1024,
  });
}

/** Naked QR as a PNG data URL at print scale. */
export function nakedQrPng(code: string): Promise<string> {
  return QRCode.toDataURL(qrTargetUrl(code), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1024,
  });
}

/**
 * The branded, seller-facing marketing asset:
 *
 *   SHOP OUR MARKET
 *   <Market name>
 *   [ QR ]
 *   Scan to see what’s available
 *   Gnome Farmers Market
 *
 * 1200×1560 PNG — sized for print (a 4" sign at 300dpi), not a screenshot. The QR itself stays
 * naked and high-contrast; the branding lives AROUND the symbol, never on top of it, so error
 * correction is spent on wear and lighting instead of decoration.
 */
export async function brandedQrPng(code: string, marketName: string): Promise<string> {
  const W = 1200;
  const H = 1560;
  const QR_SIZE = 880;

  const qrDataUrl = await QRCode.toDataURL(qrTargetUrl(code), {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: QR_SIZE,
  });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  // Card
  // Identity v4: Light Gray mount, white card, Gnome Red rule and headings,
  // Charcoal body. Printed at 4-6in this is a physical sign, so the QR keeps a
  // pure white quiet zone and every label is a deep cut for print contrast.
  ctx.fillStyle = '#F1F5F9';                       // Light Gray mount
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFFFFF';
  const pad = 48;
  ctx.fillRect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.strokeStyle = '#E32C27';                     // Gnome Red rule
  ctx.lineWidth = 6;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  const center = W / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#B71C1C';                       // deep cut: 6.57 on white
  ctx.font = '600 56px Georgia, serif';
  ctx.fillText('SHOP OUR MARKET', center, 180);

  // Market name, shrunk to fit rather than clipped.
  ctx.fillStyle = '#222222';                       // Charcoal, 15.91
  let size = 84;
  do {
    ctx.font = `700 ${size}px Georgia, serif`;
    size -= 4;
  } while (ctx.measureText(marketName).width > W - pad * 4 && size > 36);
  ctx.fillText(marketName, center, 300);

  // The symbol — dead center, white quiet zone preserved by the surrounding card.
  const qrImg = new Image();
  await new Promise<void>((resolve, reject) => {
    qrImg.onload = () => resolve();
    qrImg.onerror = () => reject(new Error('qr render failed'));
    qrImg.src = qrDataUrl;
  });
  ctx.drawImage(qrImg, center - QR_SIZE / 2, 380, QR_SIZE, QR_SIZE);

  ctx.fillStyle = '#222222';
  ctx.font = '400 44px Georgia, serif';
  ctx.fillText('Scan to see what’s available', center, 1360);
  ctx.fillStyle = '#B71C1C';
  ctx.font = '600 40px Georgia, serif';
  ctx.fillText('🌱 Gnome Farmers Market', center, 1440);

  return canvas.toDataURL('image/png');
}

/** Trigger a browser download of a data URL / blob URL. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
