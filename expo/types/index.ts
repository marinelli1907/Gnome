export type ListingType = 'sell' | 'trade' | 'free';

export type ListingStatus = 'active' | 'reserved' | 'sold';

export type ListingCategory =
  | 'produce'
  | 'herbs'
  | 'fruits'
  | 'seeds'
  | 'seedlings'
  | 'plants'
  | 'flowers'
  | 'supplies'
  | 'decor'
  | 'handmade'
  | 'gnomes'
  | 'free'
  | 'eggs'
  | 'honey'
  | 'baked'
  | 'preserves';

export type DeliveryOption = 'pickup' | 'local_delivery' | 'ships';

export type PromotionTier = 'boost_24h' | 'boost_3d' | 'sell_fast';

export type FreshnessLabel = 'harvested_today' | 'sell_soon' | 'fresh_picked' | 'limited_qty';

export type SellerPlan = 'free' | 'pro' | 'market';

export interface Promotion {
  tier: PromotionTier;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface SeedMeta {
  packetSize?: string;
  plantingSeason?: string;
  daysToGermination?: string;
  hardinessZone?: string;
}

export interface PlantMeta {
  sunNeeds?: string;
  waterNeeds?: string;
  potSize?: string;
  matureHeight?: string;
  indoor?: boolean;
  outdoor?: boolean;
}

export interface DecorMeta {
  material?: string;
  handmade?: boolean;
  dimensions?: string;
  indoorOutdoor?: 'indoor' | 'outdoor' | 'both';
}

export interface SupplyMeta {
  weight?: string;
  volume?: string;
  coverage?: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  location: string;
  bio: string;
  gardenSize?: string;
  grows: string[];
  rating: number;
  reviewCount: number;
  joinedDate: string;
  listingCount: number;
  sellerPlan?: SellerPlan;
  isVerifiedSeller?: boolean;
  totalSales?: number;
  totalEarnings?: number;
  storeName?: string;
  storeBanner?: string;
  specialties?: string[];
  followersCount?: number;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  images: string[];
  price?: number;
  type: ListingType;
  category: ListingCategory;
  status: ListingStatus;
  quantity: string;
  tradeFor?: string;
  pickupLocation: string;
  availableFrom: string;
  availableTo?: string;
  seller: User;
  distance: number;
  createdAt: string;
  promotion?: Promotion;
  freshnessLabel?: FreshnessLabel;
  isOrganic?: boolean;
  noSpray?: boolean;
  harvestDate?: string;
  pickupWindow?: string;
  quantityRemaining?: number;
  quantityTotal?: number;
  viewCount?: number;
  interestCount?: number;
  deliveryOptions?: DeliveryOption[];
  seedMeta?: SeedMeta;
  plantMeta?: PlantMeta;
  decorMeta?: DecorMeta;
  supplyMeta?: SupplyMeta;
  tags?: string[];
}

export interface Message {
  id: string;
  text: string;
  senderId: string;
  timestamp: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  otherUser: User;
  listing?: Listing;
  lastMessage: Message;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: string;
  timestamp: string;
}

export interface Review {
  id: string;
  reviewer: User;
  rating: number;
  communication: number;
  quality: number;
  reliability: number;
  comment: string;
  date: string;
}

export interface TradeRequest {
  id: string;
  fromUser: User;
  toUser: User;
  offeredListing: Listing;
  requestedListing: Listing;
  status: 'pending' | 'accepted' | 'declined';
  message?: string;
  createdAt: string;
}

export interface SellerStats {
  totalEarnings: number;
  pendingEarnings: number;
  monthlyEarnings: number;
  totalOrders: number;
  activeListings: number;
  promotedListings: number;
  topProducts: TopProduct[];
  recentTransactions: Transaction[];
  weeklySales: WeeklySale[];
  yearToDateEarnings: number;
  grossSales: number;
  fees: number;
  netEarnings: number;
}

export interface TopProduct {
  id: string;
  title: string;
  image: string;
  sales: number;
  revenue: number;
}

export interface Transaction {
  id: string;
  title: string;
  buyer: string;
  amount: number;
  date: string;
  status: 'completed' | 'pending' | 'refunded';
  type: 'sale' | 'trade' | 'promotion';
}

export interface WeeklySale {
  day: string;
  amount: number;
}

export interface SubscriptionPlan {
  id: SellerPlan;
  name: string;
  price: number;
  period: string;
  features: string[];
  maxListings: number;
  promoCredits: number;
  highlighted: boolean;
}

export interface AnnualEarnings {
  year: number;
  grossSales: number;
  fees: number;
  promotionSpend: number;
  netEarnings: number;
  totalTransactions: number;
  monthlyBreakdown: MonthlyEarning[];
}

export interface MonthlyEarning {
  month: string;
  gross: number;
  net: number;
  orders: number;
}

export type OrderStatus =
  | 'awaiting_response'
  | 'accepted'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'completed'
  | 'canceled'
  | 'sold_out';

export type OrderType = 'buy' | 'reserve' | 'pickup' | 'delivery' | 'trade';

export interface Order {
  id: string;
  listing: Listing;
  buyer: User;
  seller: User;
  status: OrderStatus;
  type: OrderType;
  quantity: string;
  totalPrice?: number;
  tradeOffer?: string;
  pickupTime?: string;
  deliveryNotes?: string;
  createdAt: string;
  updatedAt: string;
  reviewId?: string;
}

export type NotificationType =
  | 'follow'
  | 'save'
  | 'order_request'
  | 'order_accepted'
  | 'order_ready'
  | 'order_completed'
  | 'promo_ending'
  | 'new_listing'
  | 'low_inventory'
  | 'item_sold'
  | 'review_received';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  avatar?: string;
  listingImage?: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

export interface SellerReview {
  id: string;
  reviewer: User;
  seller: User;
  order?: Order;
  rating: number;
  communication: number;
  quality: number;
  reliability: number;
  comment: string;
  isRepeatBuyer?: boolean;
  date: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'apple_pay' | 'pay_on_pickup';
  label: string;
  last4?: string;
  icon: string;
}

export interface CheckoutSummary {
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
  total: number;
}
