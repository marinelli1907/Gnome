import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { marketShareUrl, WEB_BASE } from '@/lib/links';
import { useMyMarketQr } from '@/lib/db';

// SHARE YOUR MARKET — mobile half of the QR feature.
//
// The link works on every plan through the native share sheet (which carries Copy on both
// platforms — a dedicated clipboard button would need a new native dependency this change
// deliberately avoids). The QR preview follows the server's entitled flag; print-quality
// downloads live on the web dashboard, and this card says so instead of pretending a phone
// screenshot is a sign. An RPC failure renders as a failure, never as a paywall.
export default function ShareMarketCard({ uid }: { uid: string }) {
  const router = useRouter();
  const qr = useMyMarketQr(uid);
  const [shared, setShared] = useState(false);

  if (qr.isLoading || (!qr.data && !qr.isError)) return null;

  const row = qr.data;
  const marketUrl = row?.slug ? marketShareUrl({ slug: row.slug }) : null;
  const qrUrl = row?.code ? `${WEB_BASE}/q/${row.code}` : null;

  const shareLink = async () => {
    if (!marketUrl) return;
    try {
      await Share.share({ message: marketUrl, url: marketUrl });
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* user dismissed the sheet */ }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.label}>Share your Market</Text>

        {qr.isError && (
          <Text style={styles.error}>
            Couldn’t load your Market link just now — nothing about your Market has changed.
          </Text>
        )}

        {row && marketUrl && (
          <>
            <Text style={styles.url} numberOfLines={1}>{marketUrl}</Text>
            <Pressable style={styles.shareBtn} onPress={() => void shareLink()}>
              <Text style={styles.shareText}>{shared ? '✓ Shared' : 'Share link'}</Text>
            </Pressable>

            {row.entitled && qrUrl ? (
              <View style={styles.qrRow}>
                <View style={styles.qrBox}>
                  {/* High-contrast, nothing drawn over the symbol. ecl M matches the web export. */}
                  <QRCode value={qrUrl} size={120} ecl="M" backgroundColor="#FFFFFF" color="#1F2A1F" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.qrTitle}>Your Market QR</Text>
                  <Text style={styles.qrSub}>
                    This code is yours for good — renames and plan changes never break it. Download
                    print-ready signs from your dashboard on the web.
                  </Text>
                </View>
              </View>
            ) : row.code && !row.entitled ? (
              <Text style={styles.qrSub}>
                Your existing QR keeps working — anything printed still opens your Market. Upgrading
                unlocks the QR design tools again.
              </Text>
            ) : (
              <Pressable onPress={() => router.push('/upgrade')}>
                <Text style={styles.qrSub}>
                  Turn your Market into a scannable sign for your farm stand, packaging and flyers.
                  <Text style={styles.qrLink}> Unlock Market QR tools with Pro →</Text>
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 10 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.borderLight, gap: 8,
  },
  label: { fontSize: 11, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: fonts.bold },
  url: { fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.regular },
  error: { fontSize: 12, color: Colors.error, fontFamily: fonts.regular },
  shareBtn: {
    alignSelf: 'flex-start', backgroundColor: Colors.primary,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  shareText: { color: Colors.textInverse, fontSize: 13, fontFamily: fonts.bold },
  qrRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 4 },
  qrBox: { padding: 8, backgroundColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, borderColor: Colors.borderLight },
  qrTitle: { fontSize: 14, color: Colors.text, fontFamily: fonts.bold },
  qrSub: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, fontFamily: fonts.regular },
  qrLink: { color: Colors.primary, fontFamily: fonts.semibold },
});
