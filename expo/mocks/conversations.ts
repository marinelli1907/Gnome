import { Conversation } from '@/types';
import { mockUsers } from './users';
import { mockListings } from './listings';

export const mockConversations: Conversation[] = [
  {
    id: 'conv-1',
    otherUser: mockUsers[0],
    listing: mockListings[0],
    lastMessage: {
      id: 'msg-1',
      text: 'Hi! Are the tomatoes still available? I\'d love to pick some up today.',
      senderId: 'current-user',
      timestamp: '2026-03-14T18:30:00Z',
      read: true,
    },
    unreadCount: 0,
  },
  {
    id: 'conv-2',
    otherUser: mockUsers[2],
    listing: mockListings[2],
    lastMessage: {
      id: 'msg-2',
      text: 'I have some beautiful cherry tomatoes I could trade for your Thai basil! Interested?',
      senderId: 'current-user',
      timestamp: '2026-03-14T15:20:00Z',
      read: false,
    },
    unreadCount: 1,
  },
  {
    id: 'conv-3',
    otherUser: mockUsers[1],
    listing: mockListings[5],
    lastMessage: {
      id: 'msg-3',
      text: 'The honey is amazing! My family loved it. Will definitely order again.',
      senderId: mockUsers[1].id,
      timestamp: '2026-03-13T20:00:00Z',
      read: true,
    },
    unreadCount: 0,
  },
  {
    id: 'conv-4',
    otherUser: mockUsers[4],
    lastMessage: {
      id: 'msg-4',
      text: 'I just harvested a huge batch of ghost peppers if you want some! 🌶️',
      senderId: mockUsers[4].id,
      timestamp: '2026-03-12T11:00:00Z',
      read: true,
    },
    unreadCount: 0,
  },
];
