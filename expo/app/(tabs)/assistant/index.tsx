import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, Camera, Sparkles, Leaf } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useApp } from '@/providers/AppProvider';
import { ChatMessage } from '@/types';
import Colors from '@/constants/colors';

const quickPrompts = [
  "Why are my tomato leaves yellow?",
  "When should I harvest peppers?",
  "Best herbs for beginners?",
  "How often should I water basil?",
];

const gardenResponses: Record<string, string> = {
  tomato: "Yellow tomato leaves can indicate several issues:\n\n🟡 **Nitrogen deficiency** - Bottom leaves yellow first. Add compost or balanced fertilizer.\n\n🟡 **Overwatering** - Check soil drainage. Let top inch dry between waterings.\n\n🟡 **Early blight** - Dark spots with yellow halos. Remove affected leaves, improve air circulation.\n\nTry checking the bottom leaves first - if they're yellowing upward, it's likely a nutrient issue. Would you like to share a photo for a more specific diagnosis?",
  pepper: "Pepper harvest timing depends on the variety:\n\n🌶️ **Bell peppers** - Green at 60-90 days, or wait for color change (red/yellow) at 90-120 days.\n\n🌶️ **Jalapeños** - Harvest when firm and dark green (70-80 days), or wait for red for more heat.\n\n🌶️ **Habaneros** - Wait until they turn orange/red (100-120 days) for full flavor.\n\n**Pro tip:** Peppers get sweeter the longer they ripen on the vine! Cut with scissors to avoid damaging the plant.\n\nYour peppers look ready? Consider listing the extras on Gnome! 🌱",
  herb: "Great herbs for beginners:\n\n🌿 **Basil** - Loves sun and warmth. Pinch flowers to keep it bushy.\n\n🌿 **Mint** - Almost impossible to kill! Grow in a pot to prevent spreading.\n\n🌿 **Rosemary** - Drought tolerant, loves sun. Perfect for neglectful gardeners!\n\n🌿 **Chives** - Plant once, harvest forever. Great in containers.\n\n🌿 **Cilantro** - Fast growing, prefers cooler weather. Succession plant every 3 weeks.\n\nStart with 2-3 herbs near your kitchen for easy access while cooking!",
  water: "Watering basil properly is key to a healthy plant:\n\n💧 **Frequency:** Water when the top 1 inch of soil feels dry. Usually every 2-3 days in summer.\n\n💧 **Amount:** Deep watering is better than frequent light watering. Soak the soil thoroughly.\n\n💧 **Time:** Morning is best - allows leaves to dry before evening.\n\n💧 **Signs of overwatering:** Yellowing leaves, wilting despite wet soil.\n\n💧 **Signs of underwatering:** Drooping, dry/crispy leaf edges.\n\n**Pro tip:** Mulch around the base to retain moisture! 🌱",
};

function getAIResponse(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('tomato') || lower.includes('yellow')) {
    return gardenResponses['tomato'] ?? getDefaultResponse();
  }
  if (lower.includes('pepper') || lower.includes('harvest')) {
    return gardenResponses['pepper'] ?? getDefaultResponse();
  }
  if (lower.includes('herb') || lower.includes('beginner')) {
    return gardenResponses['herb'] ?? getDefaultResponse();
  }
  if (lower.includes('water') || lower.includes('basil')) {
    return gardenResponses['water'] ?? getDefaultResponse();
  }
  return getDefaultResponse();
}

function getDefaultResponse(): string {
  return "Great question! Here are some general gardening tips:\n\n🌱 **Soil health** is everything - add compost regularly.\n\n☀️ Most vegetables need **6-8 hours of sunlight** daily.\n\n💧 Water deeply but less frequently for stronger roots.\n\n🐛 Companion planting can naturally deter pests.\n\nWould you like more specific advice? Try sharing a photo of your plant, or ask about a specific vegetable or issue!";
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const { aiMessages, addAiMessage } = useApp();
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isTyping) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [isTyping, dotAnim]);

  const sendMessage = useCallback((text: string, image?: string) => {
    if (!text.trim() && !image) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      image,
      timestamp: new Date().toISOString(),
    };
    addAiMessage(userMessage);
    setInputText('');
    setIsTyping(true);

    setTimeout(() => {
      const response = image
        ? "I can see your plant photo! 📸\n\nBased on what I can see, here are my observations:\n\n🌿 The plant appears to be in decent health overall.\n\n💡 **Tip:** For the most accurate diagnosis, make sure photos are well-lit and show the affected areas up close.\n\nIf you notice any specific symptoms like spots, discoloration, or wilting, let me know and I can provide more targeted advice!\n\nWould you like to create a listing for any of your garden produce? Your neighbors might be interested! 🏡"
        : getAIResponse(text);

      const aiMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        text: response,
        timestamp: new Date().toISOString(),
      };
      addAiMessage(aiMessage);
      setIsTyping(false);
    }, 1500);
  }, [addAiMessage]);

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      sendMessage('Can you help me identify what\'s going on with this plant?', result.assets[0].uri);
    }
  }, [sendMessage]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubbleRow, isUser && styles.messageBubbleRowUser]}>
        {!isUser && (
          <View style={styles.aiAvatarSmall}>
            <Leaf size={14} color={Colors.primary} />
          </View>
        )}
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
          {item.image && (
            <Image source={{ uri: item.image }} style={styles.messageImage} contentFit="cover" />
          )}
          <Text style={[styles.messageText, isUser ? styles.userText : styles.aiText]}>{item.text}</Text>
          <Text style={[styles.messageTime, isUser ? styles.userTime : styles.aiTime]}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Sparkles size={20} color={Colors.primary} />
        </View>
        <View>
          <Text style={styles.headerTitle}>Garden AI</Text>
          <Text style={styles.headerSubtitle}>Your personal gardening assistant</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={aiMessages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <View style={styles.quickPromptsSection}>
              <Text style={styles.quickPromptsTitle}>Try asking...</Text>
              <View style={styles.quickPromptsGrid}>
                {quickPrompts.map((prompt, i) => (
                  <Pressable
                    key={i}
                    style={styles.quickPrompt}
                    onPress={() => sendMessage(prompt)}
                  >
                    <Text style={styles.quickPromptText}>{prompt}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          ListFooterComponent={
            isTyping ? (
              <View style={[styles.messageBubbleRow]}>
                <View style={styles.aiAvatarSmall}>
                  <Leaf size={14} color={Colors.primary} />
                </View>
                <View style={[styles.messageBubble, styles.aiBubble, styles.typingBubble]}>
                  <Animated.View style={{ opacity: dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }}>
                    <Text style={styles.typingDots}>● ● ●</Text>
                  </Animated.View>
                </View>
              </View>
            ) : null
          }
        />

        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable style={styles.cameraBtn} onPress={pickImage}>
            <Camera size={20} color={Colors.primary} />
          </Pressable>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Ask about your garden..."
              placeholderTextColor={Colors.textTertiary}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
            />
          </View>
          <Pressable
            style={[styles.sendBtn, inputText.trim().length > 0 && styles.sendBtnActive]}
            onPress={() => sendMessage(inputText)}
            disabled={inputText.trim().length === 0}
          >
            <Send size={18} color={inputText.trim().length > 0 ? Colors.textInverse : Colors.textTertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 8,
  },
  quickPromptsSection: {
    marginBottom: 16,
    paddingTop: 8,
  },
  quickPromptsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textTertiary,
    marginBottom: 10,
  },
  quickPromptsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickPrompt: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickPromptText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500',
  },
  messageBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
    gap: 8,
  },
  messageBubbleRowUser: {
    justifyContent: 'flex-end',
  },
  aiAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: 18,
    padding: 14,
  },
  userBubble: {
    backgroundColor: Colors.chatBubbleUser,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: Colors.chatBubbleAI,
    borderBottomLeftRadius: 4,
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: Colors.chatBubbleUserText,
  },
  aiText: {
    color: Colors.chatBubbleAIText,
  },
  messageTime: {
    fontSize: 10,
    marginTop: 6,
  },
  userTime: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'right' as const,
  },
  aiTime: {
    color: Colors.textTertiary,
  },
  typingBubble: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  typingDots: {
    fontSize: 16,
    color: Colors.primary,
    letterSpacing: 4,
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
  cameraBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
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
