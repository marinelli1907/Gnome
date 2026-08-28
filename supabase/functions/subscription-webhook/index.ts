import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { sha256, verifyAppleNotification, verifyGooglePurchase, type VerifiedSubscription } from '../_shared/subscription_providers.ts';

const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const GOOGLE_JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SUBSCRIPTION_RECORD_RULES=[
  'SERVICE_ROLE_REQUIRED','INVALID_PROVIDER','INVALID_ENVIRONMENT','INVALID_SUBSCRIPTION_STATUS',
  'MISSING_PROVIDER_REFERENCE','LIVE_PAYMENTS_DISABLED','UNKNOWN_PROVIDER_PRODUCT',
  'MARKET_NOT_FOUND','PURCHASE_ALREADY_CLAIMED',
];

async function record(admin:any,userId:string,verified:VerifiedSubscription) {
  const {data,error}=await admin.rpc('record_verified_subscription',{
    p_provider:verified.provider,p_user:userId,p_product_id:verified.productId,
    p_external_subscription_id:verified.externalSubscriptionId,
    p_external_transaction_id:verified.externalTransactionId,p_status:verified.status,
    p_environment:verified.environment,p_started_at:verified.startedAt,p_period_end:verified.periodEnd,
    p_cancel_at_period_end:verified.cancelAtPeriodEnd,p_expires_at:verified.expiresAt,
    p_event_id:verified.eventId,p_event_type:verified.eventType,p_payload_sha256:verified.payloadSha256,
    p_purchase_token:verified.purchaseToken??null,p_purchase_token_sha256:verified.purchaseTokenSha256??null,
    p_replaces_external_id:verified.replacesExternalId??null,p_status_detail:verified.statusDetail??null,
  });
  if (error) {
    const message=String(error.message??'');
    const code=String(error.code??'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
    const rule=SUBSCRIPTION_RECORD_RULES.find((value)=>message.includes(value));
    throw new Error(rule
      ? rule
      : `SUBSCRIPTION_RECORD_SQLSTATE_${code||'UNKNOWN'}`);
  }
  return data;
}

async function recordRefusal(admin:any,provider:string,eventId:string,eventType:string,environment:string,payload:string,detail:string) {
  const digest=await sha256(payload);
  await admin.from('subscription_provider_events').upsert({
    provider,
    external_event_id:eventId,
    event_type:eventType,
    environment,
    payload_sha256:digest,
    outcome:'REFUSED',
    detail,
    processed_at:new Date().toISOString(),
  },{onConflict:'provider,external_event_id'});
}

async function verifyGooglePush(req:Request) {
  const audience=Deno.env.get('GOOGLE_PLAY_PUBSUB_AUDIENCE')?.trim();
  const expectedEmail=Deno.env.get('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT')?.trim().toLowerCase();
  if (!audience || !expectedEmail) throw new Error('GOOGLE_PUBSUB_NOT_CONFIGURED');
  const bearer=(req.headers.get('Authorization')??'').replace(/^Bearer\s+/i,'');
  if (!bearer) throw new Error('GOOGLE_PUBSUB_UNAUTHENTICATED');
  const {payload}=await jwtVerify(bearer,GOOGLE_JWKS,{
    audience,issuer:['https://accounts.google.com','accounts.google.com'],algorithms:['RS256'],
  });
  if (String(payload.email??'').toLowerCase()!==expectedEmail || payload.email_verified!==true) {
    throw new Error('GOOGLE_PUBSUB_UNAUTHENTICATED');
  }
}

Deno.serve(async (req:Request) => {
  if (req.method!=='POST') return json(405,{error:'METHOD_NOT_ALLOWED'});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body:any={};
  try {
    body=await req.json().catch(()=>({})) as any;
    if (typeof body.signedPayload==='string') {
      const apple=await verifyAppleNotification(body.signedPayload);
      if (apple.test) return json(200,{ok:true,test:true});
      const {verified}=apple;
      let userId=apple.userId;
      if (!userId) {
        const {data:subscription}=await admin.from('market_subscriptions')
          .select('user_id')
          .eq('billing_source','APPLE')
          .eq('external_transaction_id',verified.externalSubscriptionId)
          .eq('kind','plan')
          .maybeSingle();
        userId=subscription?.user_id??null;
      }
      if (!userId) {
        await recordRefusal(admin,'APPLE',verified.eventId,verified.eventType,verified.environment,body.signedPayload,'APPLE_PURCHASE_NOT_BOUND_YET');
        return json(202,{ok:true,deferred:true});
      }
      const result=await record(admin,userId,verified);
      return json(200,{ok:true,duplicate:result?.outcome==='DUPLICATE'});
    }

    await verifyGooglePush(req);
    const messageId=String(body.message?.messageId??'');
    const encoded=String(body.message?.data??'');
    if (!messageId || !encoded) return json(400,{error:'INVALID_PUBSUB_MESSAGE'});
    const payload=JSON.parse(atob(encoded)) as any;
    if (payload.testNotification) return json(204,{});
    const purchaseToken=String(payload.subscriptionNotification?.purchaseToken??'');
    if (!purchaseToken) return json(400,{error:'MISSING_PURCHASE_TOKEN'});
    const tokenHash=await sha256(purchaseToken);
    const {data:secret}=await admin.from('subscription_provider_secrets')
      .select('subscription_id').eq('provider','GOOGLE_PLAY').eq('token_sha256',tokenHash).maybeSingle();
    if (!secret?.subscription_id) return json(409,{error:'PURCHASE_NOT_BOUND_YET'});
    const {data:subscription}=await admin.from('market_subscriptions').select('user_id')
      .eq('id',secret.subscription_id).maybeSingle();
    if (!subscription?.user_id) return json(409,{error:'PURCHASE_NOT_BOUND_YET'});
    const verified=await verifyGooglePurchase(purchaseToken,String(subscription.user_id));
    verified.eventId=`GOOGLE_PLAY:${messageId}`;
    verified.eventType=`RTDN:${String(payload.subscriptionNotification?.notificationType??'UNKNOWN')}`;
    verified.payloadSha256=await sha256(encoded);
    const result=await record(admin,String(subscription.user_id),verified);
    return json(200,{ok:true,duplicate:result?.outcome==='DUPLICATE'});
  } catch (error) {
    const message=error instanceof Error?error.message:'WEBHOOK_FAILED';
    const bodyHashSource=typeof body?.signedPayload==='string'
      ? body.signedPayload
      : typeof body?.message?.data==='string'
        ? body.message.data
        : '';
    const safe=(/^SUBSCRIPTION_RECORD_SQLSTATE_[A-Z0-9]+$/.test(message)?message:null)??['APPLE_SERVER_NOT_CONFIGURED','APPLE_API_AUTH_FAILED','APPLE_TRANSACTION_NOT_FOUND',
      'APPLE_API_RATE_LIMITED','APPLE_API_UNAVAILABLE','APPLE_NOTIFICATION_VERIFICATION_FAILED',
      'INCOMPLETE_APPLE_TRANSACTION','GOOGLE_PUBSUB_NOT_CONFIGURED','GOOGLE_PUBSUB_UNAUTHENTICATED',
      'GOOGLE_PLAY_SERVER_NOT_CONFIGURED','GOOGLE_PLAY_AUTH_FAILED','GOOGLE_PLAY_VERIFICATION_FAILED',
      'GOOGLE_PURCHASE_NOT_FOUND','UNKNOWN_PROVIDER_PRODUCT','LIVE_PAYMENTS_DISABLED','PURCHASE_ALREADY_CLAIMED',
      'MARKET_NOT_FOUND','SERVICE_ROLE_REQUIRED','INVALID_PROVIDER','INVALID_ENVIRONMENT',
      'INVALID_SUBSCRIPTION_STATUS','MISSING_PROVIDER_REFERENCE']
      .find((value)=>message.includes(value))??'WEBHOOK_REJECTED';
    if (bodyHashSource) {
      await recordRefusal(admin,typeof body?.signedPayload==='string'?'APPLE':'GOOGLE_PLAY',
        `WEBHOOK_FAILED:${await sha256(bodyHashSource)}`,'WEBHOOK_FAILED','TEST',bodyHashSource,safe).catch(()=>{});
    }
    const status=message.includes('UNAUTHENTICATED')?401:message.includes('NOT_CONFIGURED')?503:400;
    console.error('subscription-webhook failed:',safe);
    return json(status,{error:'WEBHOOK_REJECTED'});
  }
});
