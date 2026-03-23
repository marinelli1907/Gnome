import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { Send } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/providers/AppProvider';
import Colors from '@/constants/colors';

interface ChatMsg {
  id: string;
  text: string;
  senderId: string;
  timestamp: string;
}

const mockMessages: ChatMsg[] = [
  {
    id: '1',
    text: 'Hi there! I saw your listing for the heirloom tomatoes. Are they still available?',
    senderId: 'current-user',
    timestamp: '2026-03-14T18:00:00Z',
  },
  {
    id: '2',
    text: 'Yes! I just picked a fresh batch this morning. They look gorgeous this season 🍅',
    senderId: 'other',
    timestamp: '2026-03-14T18:05:00Z',
  },
  {
    id: '3',
    text: 'Amazing! Can I pick them up today around 5pm?',
    senderId: 'current-user',
    timestamp: '2026-03-14T18:10:00Z',
  },
  {
    id: '4',
    text: 'That works perfectly! I\'ll be home all afternoon. The address is on the listing. Just text when you\'re on your way!',
    senderId: 'other',
    timestamp: '2026-03-14T18:12:00Z',
  },
  {
    id: '5',
    text: 'Thank you so much! See you then 😊',
    senderId: 'current-user',
    timestamp: '2026-03-14T18:15:00Z',
  },
];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { conversations } = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>(mockMessages);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const conversation = conversations.find(c => c.id === id);
  const otherUser = conversation?.otherUser;

  const sendMessage = useCallback(() => {
    if (!inputText.trim()) return;
    const newMsg: ChatMsg = {
      id: `msg-${Date.now()}`,
      text: inputText.trim(),
      senderId: 'current-user',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, newMsg]);
    setInputText('');

    setTimeout(() => {
      const reply: ChatMsg = {
        id: `msg-${Date.now() + 1}`,
        text: "Sounds good! Let me know if you have any other questions 😊",
        senderId: 'other',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, reply]);
    }, 2000);
  }, [inputText]);

  const renderMessage = useCallback(({ item }: { item: ChatMsg }) => {
    const isUser = item.senderId === 'current-user';
    return (
      <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
        {!isUser && otherUser && (
          <Image source={{ uri: otherUser.avatar }} style={styles.msgAvatar} contentFit="cover" />
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.otherBubble]}>
          <Text style={[styles.bubbleText, isUser ? styles.userBubbleText : styles.otherBubbleText]}>
            {item.text}
          </Text>
          <Text style={[styles.bubbleTime, isUser ? styles.userBubbleTime : styles.otherBubbleTime]}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  }, [otherUser]);

  return (
    <>
      <Stack.Screen
        options={{
          title: otherUser?.name ?? 'Chat',
          headerStyle: { backgroundColor: Colors.surface },
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {conversation?.listing && (
          <View style={styles.listingBanner}>
            <Image source={{ uri: conversation.listing.images[0] }} style={styles.listingBannerImage} contentFit="cover" />
            <View style={styles.listingBannerInfo}>
              <Text style={styles.listingBannerTitle} numberOfLines={1}>{conversation.listing.title}</Text>
              <Text style={styles.listingBannerPrice}>
                {conversation.listing.type === 'free' ? 'Free' : conversation.listing.type === 'trade' ? 'Trade' : `$${conversation.listing.price}`}
              </Text>
            </View>
          </View>
        )}

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Type a message..."
              placeholderTextColor={Colors.textTertiary}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
            />
          </View>
          <Pressable
            style={[styles.sendBtn, inputText.trim().length > 0 && styles.sendBtnActive]}
            onPress={sendMessage}
            disabled={inputText.trim().length === 0}
          >
            <Send size={18} color={inputText.trim().length > 0 ? Colors.textInverse : Colors.textTertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  listingBannerImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  listingBannerInfo: {
    flex: 1,
  },
  listingBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  listingBannerPrice: {
    fontSize: 12,
    color: Colors.primaryLight,
    fontWeight: '600',
    marginTop: 1,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 18,
    padding: 12,
    paddingBottom: 8,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  userBubbleText: {
    color: Colors.textInverse,
  },
  otherBubbleText: {
    color: Colors.text,
  },
  bubbleTime: {
    fontSize: 10,
    marginTop: 4,
  },
  userBubbleTime: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'right',
  },
  otherBubbleTime: {
    color: Colors.textTertiary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
  },
  input: {
    fontSize: 15,
    color: Colors.text,
    maxHeight: 80,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendBtnActive: {
    backgroundColor: Colors.primary,
  },
});
