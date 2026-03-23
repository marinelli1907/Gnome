import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Download, Calendar, DollarSign, Receipt, TrendingUp, FileText, ChevronDown, ChevronUp } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { mockAnnualEarnings } from '@/mocks/seller';

export default function TaxSummaryScreen() {
  const earnings = mockAnnualEarnings;
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const handleDownload = () => {
    Alert.alert(
      'Tax Report',
      'In a live app, this would download a PDF or CSV of your annual earnings report for tax purposes.',
    );
  };

  const summaryItems = [
    { label: 'Gross Sales', value: `$${earnings.grossSales}`, icon: DollarSign, color: Colors.primary },
    { label: 'Platform Fees', value: `-$${earnings.fees}`, icon: Receipt, color: Colors.accent },
    { label: 'Promotion Spend', value: `-$${earnings.promotionSpend}`, icon: TrendingUp, color: Colors.promoted },
    { label: 'Net Earnings', value: `$${earnings.netEarnings}`, icon: FileText, color: Colors.freshGreen },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Earnings & Tax',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.yearCard}>
          <View style={styles.yearHeader}>
            <View style={styles.yearBadge}>
              <Calendar size={16} color={Colors.primary} />
              <Text style={styles.yearText}>{earnings.year}</Text>
            </View>
            <Text style={styles.ytdLabel}>Year-to-Date</Text>
          </View>
          <Text style={styles.bigAmount}>${earnings.netEarnings}</Text>
          <Text style={styles.bigLabel}>Net Earnings</Text>
          <View style={styles.yearMeta}>
            <Text style={styles.yearMetaText}>{earnings.totalTransactions} transactions</Text>
            <View style={styles.yearMetaDot} />
            <Text style={styles.yearMetaText}>${(earnings.netEarnings / (new Date().getMonth() + 1)).toFixed(0)}/mo avg</Text>
          </View>
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Annual Summary</Text>
          <View style={styles.summaryGrid}>
            {summaryItems.map((item, i) => {
              const IconComp = item.icon;
              return (
                <View key={i} style={styles.summaryCard}>
                  <View style={[styles.summaryIcon, { backgroundColor: item.color + '15' }]}>
                    <IconComp size={16} color={item.color} />
                  </View>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                  <Text style={[
                    styles.summaryValue,
                    item.value.startsWith('-') && styles.summaryValueNeg,
                    item.label === 'Net Earnings' && styles.summaryValueNet,
                  ]}>
                    {item.value}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.breakdownSection}>
          <Text style={styles.sectionTitle}>Monthly Breakdown</Text>
          {earnings.monthlyBreakdown.map((month) => {
            const isExpanded = expandedMonth === month.month;
            const hasData = month.gross > 0;
            return (
              <Pressable
                key={month.month}
                style={[styles.monthRow, !hasData && styles.monthRowEmpty]}
                onPress={() => hasData && setExpandedMonth(isExpanded ? null : month.month)}
                disabled={!hasData}
              >
                <View style={styles.monthHeader}>
                  <Text style={[styles.monthName, !hasData && styles.monthNameEmpty]}>
                    {month.month}
                  </Text>
                  <View style={styles.monthRight}>
                    <Text style={[styles.monthAmount, !hasData && styles.monthAmountEmpty]}>
                      {hasData ? `$${month.net}` : '--'}
                    </Text>
                    {hasData && (
                      isExpanded
                        ? <ChevronUp size={16} color={Colors.textTertiary} />
                        : <ChevronDown size={16} color={Colors.textTertiary} />
                    )}
                  </View>
                </View>
                {isExpanded && (
                  <View style={styles.monthExpanded}>
                    <View style={styles.monthDetail}>
                      <Text style={styles.monthDetailLabel}>Gross</Text>
                      <Text style={styles.monthDetailValue}>${month.gross}</Text>
                    </View>
                    <View style={styles.monthDetail}>
                      <Text style={styles.monthDetailLabel}>Net</Text>
                      <Text style={styles.monthDetailValue}>${month.net}</Text>
                    </View>
                    <View style={styles.monthDetail}>
                      <Text style={styles.monthDetailLabel}>Orders</Text>
                      <Text style={styles.monthDetailValue}>{month.orders}</Text>
                    </View>
                    <View style={styles.monthBar}>
                      <View
                        style={[
                          styles.monthBarFill,
                          { width: `${Math.min((month.gross / Math.max(...earnings.monthlyBreakdown.map(m => m.gross))) * 100, 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.disclaimer}>
          <FileText size={16} color={Colors.textTertiary} />
          <Text style={styles.disclaimerText}>
            Gnome tracks your earnings to help you with tax reporting. This is not tax advice. Consult a tax professional for your specific situation.
          </Text>
        </View>

        <Pressable style={styles.downloadBtn} onPress={handleDownload}>
          <Download size={18} color="#FFFFFF" />
          <Text style={styles.downloadBtnText}>Download Tax Report</Text>
        </Pressable>

        <Pressable style={styles.csvBtn} onPress={handleDownload}>
          <FileText size={18} color={Colors.primary} />
          <Text style={styles.csvBtnText}>Export as CSV</Text>
        </Pressable>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  yearCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.primaryDark,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  yearBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  yearText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  ytdLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  bigAmount: {
    fontSize: 42,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  bigLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  yearMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  yearMetaText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  yearMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  summarySection: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 14,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
  },
  summaryIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  summaryValueNeg: {
    color: Colors.accent,
  },
  summaryValueNet: {
    color: Colors.primary,
  },
  breakdownSection: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  monthRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
  },
  monthRowEmpty: {
    opacity: 0.5,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monthName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  monthNameEmpty: {
    color: Colors.textTertiary,
  },
  monthRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthAmount: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  monthAmountEmpty: {
    color: Colors.textTertiary,
    fontWeight: '400' as const,
  },
  monthExpanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  monthDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthDetailLabel: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  monthDetailValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  monthBar: {
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  monthBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: Colors.earningsBg,
    borderRadius: 14,
    padding: 16,
  },
  disclaimerText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    flex: 1,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
  },
  downloadBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  csvBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  csvBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  bottomSpacer: {
    height: 40,
  },
});
