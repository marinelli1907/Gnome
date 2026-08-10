// Drilldown picker over the backend taxonomy tree. One component, two jobs:
//  - Browse: filter at ANY level (Vegetables, Vegetables›Tomatoes, or ›Roma)
//  - Sell:   walk to a specific product ("What are you selling?"), with a
//            "General {name}" row so a seller with plain tomatoes isn't forced
//            to invent a variety.
// Never renders the 308-node flat list — one level at a time, with breadcrumb
// back-navigation, selected state, and clear/reset.
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import {
  ancestorsOf,
  type TaxonomyIndex,
  type TaxonomyNode,
} from '@/lib/taxonomy';

interface Props {
  visible: boolean;
  index: TaxonomyIndex;
  /** Currently selected node (highlights + opens at its level). */
  selectedId?: string | null;
  /** 'filter' allows picking any level; 'sell' pushes to a specific product. */
  mode: 'filter' | 'sell';
  title?: string;
  onSelect: (node: TaxonomyNode | null) => void;
  onClose: () => void;
}

export default function TaxonomyPicker({
  visible,
  index,
  selectedId,
  mode,
  title,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const selected = selectedId ? index.byId.get(selectedId) ?? null : null;

  // The level we're looking at = children of `parent` (null = top level).
  const [parentId, setParentId] = useState<string | null>(() =>
    selected ? selected.parent_id : null,
  );
  // Re-sync the level when the sheet is reopened with a different selection.
  const [syncedFor, setSyncedFor] = useState<string | null | undefined>(selectedId);
  if (visible && syncedFor !== selectedId) {
    setSyncedFor(selectedId);
    setParentId(selected ? selected.parent_id : null);
  }

  const parent = parentId ? index.byId.get(parentId) ?? null : null;
  const level = index.childrenOf(parentId);
  const crumb = useMemo(
    () => (parent ? ancestorsOf(index, parent).map((n) => n.name).join(' › ') : null),
    [index, parent],
  );

  const pick = (node: TaxonomyNode) => {
    onSelect(node);
    onClose();
  };

  const rows: Array<
    | { kind: 'general'; node: TaxonomyNode }
    | { kind: 'node'; node: TaxonomyNode }
  > = useMemo(() => {
    const out: Array<{ kind: 'general' | 'node'; node: TaxonomyNode }> = [];
    if (parent) {
      // Selecting the level itself: "All Tomatoes" (filter) / "General Tomatoes" (sell).
      out.push({ kind: 'general', node: parent });
    }
    for (const n of level) out.push({ kind: 'node', node: n });
    return out as any;
  }, [parent, level]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.header}>
          {parent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Back to ${parent.parent_id ? index.byId.get(parent.parent_id)?.name ?? 'previous level' : 'all categories'}`}
              hitSlop={10}
              onPress={() => setParentId(parent.parent_id)}
              style={styles.headerBtn}
            >
              <ChevronLeft size={22} color={Colors.primary} />
            </Pressable>
          ) : (
            <View style={styles.headerBtn} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {crumb ?? title ?? (mode === 'sell' ? 'What are you selling?' : 'Browse categories')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close category picker"
            hitSlop={10}
            onPress={onClose}
            style={styles.headerBtn}
          >
            <X size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {mode === 'filter' && selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear category filter"
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            style={styles.clearRow}
          >
            <Text style={styles.clearText}>Clear filter ({selected.name})</Text>
          </Pressable>
        ) : null}

        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.kind}:${r.node.id}`}
          renderItem={({ item }) => {
            const { node } = item;
            const isGeneral = item.kind === 'general';
            const kids = isGeneral ? [] : index.childrenOf(node.id);
            const hasKids = kids.length > 0;
            const isSelected = selectedId === node.id && !hasKids;
            const label = isGeneral
              ? mode === 'sell'
                ? `General ${node.name}`
                : `All ${node.name}`
              : node.name;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hasKids ? `${label}, opens subcategories` : label}
                accessibilityState={{ selected: selectedId === node.id }}
                onPress={() => {
                  if (!isGeneral && hasKids) setParentId(node.id);
                  else pick(node);
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: Colors.backgroundSecondary }]}
              >
                {node.icon && !isGeneral ? <Text style={styles.rowIcon}>{node.icon}</Text> : null}
                <Text style={[styles.rowText, isGeneral && styles.rowTextGeneral]} numberOfLines={1}>
                  {label}
                </Text>
                {selectedId === node.id ? (
                  <Check size={18} color={Colors.primary} />
                ) : !isGeneral && hasKids ? (
                  <ChevronRight size={18} color={Colors.textTertiary} />
                ) : null}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  clearRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: Colors.backgroundSecondary,
  },
  clearText: { color: Colors.accent, fontFamily: fonts.semibold, fontSize: 14 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  rowIcon: { fontSize: 18, fontFamily: fonts.regular },
  rowText: { flex: 1, fontSize: 16, fontFamily: fonts.regular, color: Colors.text },
  rowTextGeneral: { fontFamily: fonts.semibold, color: Colors.primary },
  sep: { height: 1, backgroundColor: Colors.border, marginLeft: 20 },
});
