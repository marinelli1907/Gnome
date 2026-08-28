import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  deepLinkToSubscriptions,
  getTransactionJwsIOS,
  type ProductSubscription,
  type Purchase,
  useIAP,
} from 'expo-iap';
import { supabase } from '@/lib/supabase';
import type { MarketPlan } from '@/types';

export const NATIVE_PRODUCT_FOR_PLAN: Record<'grower'|'farm',string> = {
  grower:'gnome.pro.monthly',
  farm:'gnome.farm.monthly',
};
export const NATIVE_SUBSCRIPTION_PRODUCTS=Object.values(NATIVE_PRODUCT_FOR_PLAN);

type NativePurchaseState={
  kind:'idle'|'purchasing'|'verifying'|'restoring'|'pending'|'active'|'error';
  message?:string;
};

const isThreeMonthFreeTrialOffer=(offer:NonNullable<ProductSubscription['subscriptionOffers']>[number]) => {
  const phases=offer.pricingPhasesAndroid?.pricingPhaseList??[];
  return phases.some((phase)=>{
    const period=phase.billingPeriod.match(/^P(\d+)M$/);
    return Number(phase.priceAmountMicros)===0
      && period!==null
      && Number(period[1])*phase.billingCycleCount===3;
  });
};

const looksLikeJws=(value:string|undefined|null) => typeof value==='string' && value.split('.').length===3;

export function useNativeSubscriptions(
  userId:string|undefined,
  onVerified:()=>Promise<unknown>|unknown,
  enabled=true,
) {
  const [state,setState]=useState<NativePurchaseState>({kind:'idle'});
  const processed=useRef(new Set<string>());

  const syncPurchase=useCallback(async (purchase:Purchase) => {
    if (!enabled) return;
    const key=`${purchase.store}:${purchase.transactionId??purchase.purchaseToken??purchase.id}`;
    if (processed.current.has(key)) return;
    if (purchase.purchaseState==='pending') {
      setState({kind:'pending',message:'Your payment is pending with the store. Access starts only after the store confirms it.'});
      return;
    }
    if (purchase.purchaseState!=='purchased' || !purchase.purchaseToken) {
      setState({kind:'error',message:'The store did not return a completed subscription to verify.'});
      return;
    }
    processed.current.add(key);
    setState({kind:'verifying'});
    const provider=Platform.OS==='ios'?'APPLE':'GOOGLE_PLAY';
    const appleStoreKitJws=provider==='APPLE' ? await getTransactionJwsIOS(purchase.productId) : null;
    const appleJws=provider==='APPLE'
      ? (looksLikeJws(appleStoreKitJws) ? appleStoreKitJws : looksLikeJws(purchase.purchaseToken) ? purchase.purchaseToken : null)
      : null;
    const {data,error}=await supabase.functions.invoke('subscription-sync',{
      body:provider==='APPLE'
        ? {provider,transaction_jws:appleJws}
        : {provider,purchase_token:purchase.purchaseToken},
    });
    const body=(data??{}) as {ok?:boolean;entitled?:boolean;error?:string;status?:string};
    if (error || !body.ok) {
      processed.current.delete(key);
      const accountMismatch=body.error?.includes('ACCOUNT_MISMATCH') || body.error==='PURCHASE_ALREADY_CLAIMED';
      setState({kind:'error',message:accountMismatch
        ? 'This store subscription is already linked to another Gnome account.'
        : body.error==='LIVE_PAYMENTS_DISABLED'
          ? 'Live subscriptions are not active yet. Nothing changed on your Gnome account.'
          : 'Gnome could not verify this purchase with the store. It was not used to unlock a plan.'});
      return;
    }
    if (body.entitled) {
      await iap.finishTransaction({purchase,isConsumable:false});
      await onVerified();
      setState({kind:'active',message:'Your subscription was verified by the store and your plan is active.'});
    } else {
      setState({kind:body.status==='pending'?'pending':'idle',message:body.status==='pending'
        ? 'Your payment is pending with the store. Access starts only after confirmation.'
        : 'Your subscription history was synced. No active paid access was found.'});
    }
  // iap methods are stable for one connection; including the object causes a callback loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled,userId,onVerified]);

  const iap=useIAP({
    onPurchaseSuccess:(purchase)=>{if (enabled) void syncPurchase(purchase);},
    onPurchaseError:(error)=>{
      if (enabled) setState({kind:'error',message:error.code==='user-cancelled'
        ? 'Purchase canceled. Nothing was charged.'
        : 'The store could not complete that purchase.'});
    },
    onSubscriptionBillingIssue:()=>{
      if (enabled) setState({kind:'error',message:'Your store reported a billing issue. Open subscription management to resolve it.'});
    },
  });

  useEffect(()=>{
    if (!enabled || !iap.connected) return;
    void iap.fetchProducts({skus:NATIVE_SUBSCRIPTION_PRODUCTS,type:'subs'}).catch(()=>{
      setState({kind:'error',message:'Seller plans are temporarily unavailable from the store.'});
    });
  },[enabled,iap.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if (state.kind!=='restoring' || iap.availablePurchases.length===0) return;
    void Promise.all(iap.availablePurchases
      .filter((purchase)=>NATIVE_SUBSCRIPTION_PRODUCTS.includes(purchase.productId))
      .map(syncPurchase));
  },[iap.availablePurchases,state.kind,syncPurchase]);

  const byProduct=useMemo(()=>Object.fromEntries(iap.subscriptions.map((product)=>[product.id,product])),[iap.subscriptions]);

  const foundingEligibility=useCallback((plan:MarketPlan):'eligible'|'ineligible'|'store-confirmed'|'unavailable' => {
    if (plan!=='grower' && plan!=='farm') return 'unavailable';
    const product=byProduct[NATIVE_PRODUCT_FOR_PLAN[plan]];
    if (!product) return 'unavailable';
    if (product.platform==='ios') return 'store-confirmed';
    return (product.subscriptionOffers??[]).some(isThreeMonthFreeTrialOffer)?'eligible':'ineligible';
  },[byProduct]);

  const purchase=useCallback(async (plan:MarketPlan,promoCode?:string) => {
    if (!enabled || !userId || (plan!=='grower' && plan!=='farm')) return;
    const productId=NATIVE_PRODUCT_FOR_PLAN[plan];
    const product=byProduct[productId];
    if (!product) {
      setState({kind:'error',message:'That plan is not configured in this store yet.'});
      return;
    }
    const founding=promoCode?.trim().toUpperCase()==='FOUNDING3';
    const accountHash=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,userId.toLowerCase());
    const current=iap.availablePurchases.find((item)=>NATIVE_SUBSCRIPTION_PRODUCTS.includes(item.productId));
    const offers=product.platform==='android'?product.subscriptionOffers??[]:[];
    const selected=founding
      ? offers.find(isThreeMonthFreeTrialOffer)
      : offers.find((offer)=>!isThreeMonthFreeTrialOffer(offer));
    if (Platform.OS==='android' && founding && !selected) {
      setState({kind:'error',message:'Google Play says this account is not eligible for the Founding3 trial.'});
      return;
    }
    if (Platform.OS==='android' && !selected?.offerTokenAndroid) {
      setState({kind:'error',message:'The monthly plan is not configured correctly in Google Play yet.'});
      return;
    }
    setState({kind:'purchasing'});
    try {
      await iap.requestPurchase({type:'subs',request:{
        apple:{sku:productId,appAccountToken:userId,andDangerouslyFinishTransactionAutomatically:false},
        google:{skus:[productId],obfuscatedAccountId:accountHash,
          subscriptionOffers:selected?.offerTokenAndroid?[{sku:productId,offerToken:selected.offerTokenAndroid}]:[],
          purchaseToken:current?.purchaseToken??undefined,
          subscriptionProductReplacementParams:current && current.productId!==productId?{
            oldProductId:current.productId,
            replacementMode:plan==='farm'?'with-time-proration':'deferred',
          }:undefined,
        },
      }});
    } catch {
      setState({kind:'error',message:'The store could not start that subscription purchase.'});
    }
  },[byProduct,enabled,iap,userId]);

  const restore=useCallback(async () => {
    if (!enabled) return;
    setState({kind:'restoring'});
    processed.current.clear();
    try {
      const cached=iap.availablePurchases.filter((purchase)=>NATIVE_SUBSCRIPTION_PRODUCTS.includes(purchase.productId));
      if (Platform.OS==='ios' && cached.length>0) {
        await Promise.all(cached.map(syncPurchase));
        return;
      }
      await iap.restorePurchases({onlyIncludeActiveItemsIOS:true,includeSuspendedAndroid:true});
    } catch {
      setState({kind:'error',message:'The store could not restore subscriptions right now.'});
    }
  },[enabled,iap,syncPurchase]);

  const manage=useCallback(async (productId?:string) => {
    if (!enabled) return;
    await deepLinkToSubscriptions({skuAndroid:productId??null,packageNameAndroid:'app.boonesystems.gnome'});
  },[enabled]);

  return {connected:iap.connected,products:byProduct,state,purchase,restore,manage,foundingEligibility};
}
