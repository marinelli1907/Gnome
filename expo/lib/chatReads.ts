import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { ChatSummary } from '@/types';

// Per-device "last read" timestamps for claim chats. Local only (not synced),
// which is fine for a lightweight unread dot in V1.4 — no read receipts.
const KEY = 'gnome:chatLastRead:v1';

export async function markChatRead(claimId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[claimId] = Date.now();
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

export function useChatReads() {
  const [reads, setReads] = useState<Record<string, number>>({});
  const reload = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      setReads(raw ? JSON.parse(raw) : {});
    } catch {
      setReads({});
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { reads, reload };
}

export function isUnread(
  chat: ChatSummary,
  uid: string | null,
  reads: Record<string, number>,
): boolean {
  if (!chat.lastSenderId || chat.lastSenderId === uid) return false;
  const last = new Date(chat.lastAt).getTime();
  return last > (reads[chat.claimId] ?? 0);
}
