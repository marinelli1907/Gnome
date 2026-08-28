import { createClient } from 'npm:@supabase/supabase-js@2';
import { sha256, verifyAppleTransaction, verifyGooglePurchase } from '../_shared/subscription_providers.ts';

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{
  status,headers:{...CORS,'Content-Type':'application/json'},
});
const SUBSCRIPTION_RECORD_RULES=[
  'SERVICE_ROLE_REQUIRED','INVALID_PROVIDER','INVALID_ENVIRONMENT','INVALID_SUBSCRIPTION_STATUS',
  'MISSING_PROVIDER_REFERENCE','LIVE_PAYMENTS_DISABLED','UNKNOWN_PROVIDER_PRODUCT',
  'MARKET_NOT_FOUND','PURCHASE_ALREADY_CLAIMED',
];

Deno.serve(async (req:Request) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if (req.method!=='POST') return reply(405,{error:'METHOD_NOT_ALLOWED'});
  let admin:any=null;
  let body:{provider?:string;transaction_jws?:string;purchase_token?:string}={};
  let provider='';
  try {
    admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token=(req.headers.get('Authorization')??'').replace(/^Bearer\s+/i,'');
    const {data,error}=await admin.auth.getUser(token);
    const uid=data.user?.id;
    if (error || !uid) return reply(401,{error:'UNAUTHENTICATED'});
    body=await req.json().catch(()=>({})) as {provider?:string;transaction_jws?:string;purchase_token?:string};
    provider=String(body.provider??'').toUpperCase();
    const verified=provider==='APPLE'
      ? await verifyAppleTransaction(String(body.transaction_jws??''),uid)
      : provider==='GOOGLE_PLAY'
        ? await verifyGooglePurchase(String(body.purchase_token??''),uid)
        : null;
    if (!verified) return reply(400,{error:'INVALID_PROVIDER'});

    const {data:result,error:recordError}=await admin.rpc('record_verified_subscription',{
      p_provider:verified.provider,p_user:uid,p_product_id:verified.productId,
      p_external_subscription_id:verified.externalSubscriptionId,
      p_external_transaction_id:verified.externalTransactionId,p_status:verified.status,
      p_environment:verified.environment,p_started_at:verified.startedAt,p_period_end:verified.periodEnd,
      p_cancel_at_period_end:verified.cancelAtPeriodEnd,p_expires_at:verified.expiresAt,
      p_event_id:verified.eventId,p_event_type:verified.eventType,p_payload_sha256:verified.payloadSha256,
      p_purchase_token:verified.purchaseToken??null,p_purchase_token_sha256:verified.purchaseTokenSha256??null,
      p_replaces_external_id:verified.replacesExternalId??null,p_status_detail:verified.statusDetail??null,
    });
    if (recordError) {
      const message=String(recordError.message??'');
      const code=String(recordError.code??'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
      const rule=SUBSCRIPTION_RECORD_RULES.find((value)=>message.includes(value));
      throw new Error(rule
        ? rule
        : `SUBSCRIPTION_RECORD_SQLSTATE_${code||'UNKNOWN'}`);
    }
    const expiresAt=verified.expiresAt ? Date.parse(verified.expiresAt) : NaN;
    const entitled=['active','trialing','grace_period','canceled','cancelled'].includes(verified.status)
      && Number.isFinite(expiresAt) && expiresAt>Date.now();
    return reply(200,{ok:true,entitled,status:verified.status,plan:(result as any)?.paid_plan??null,
      source:verified.provider,environment:verified.environment,duplicate:(result as any)?.outcome==='DUPLICATE'});
  } catch (error) {
    const code=error instanceof Error?error.message:'VERIFICATION_FAILED';
    const safe=(/^SUBSCRIPTION_RECORD_SQLSTATE_[A-Z0-9]+$/.test(code)?code:null)??['APPLE_SERVER_NOT_CONFIGURED','GOOGLE_PLAY_SERVER_NOT_CONFIGURED','APPLE_ACCOUNT_MISMATCH',
      'APPLE_API_AUTH_FAILED','APPLE_TRANSACTION_NOT_FOUND','APPLE_API_RATE_LIMITED','APPLE_API_UNAVAILABLE',
      'APPLE_API_RESPONSE_INVALID','APPLE_STATUS_LOOKUP_FAILED','APPLE_STATUS_RESPONSE_INVALID',
      'APPLE_TRANSACTION_LOOKUP_FAILED','APPLE_TRANSACTION_RESPONSE_INVALID','APPLE_TRANSACTION_ID_MISMATCH',
      'APPLE_TRANSACTION_ID_INVALID','APPLE_APP_IDENTIFIER_INVALID',
      'APPLE_TRANSACTION_ID_NOT_ORIGINAL','APPLE_ORIGINAL_TRANSACTION_NOT_FOUND',
      'APPLE_ACCOUNT_NOT_FOUND','APPLE_APP_NOT_FOUND',
      'APPLE_SIGNED_DATA_RETRYABLE_VERIFICATION_FAILED','APPLE_SIGNED_DATA_VERIFICATION_FAILED',
      'APPLE_CERTIFICATE_VERIFICATION_FAILED','APPLE_CERTIFICATE_CHAIN_LENGTH_INVALID','APPLE_CERTIFICATE_INVALID',
      'APPLE_CERTIFICATE_CHAIN_VERIFICATION_FAILED','APPLE_SIGNATURE_VERIFICATION_FAILED','APPLE_SIGNED_PAYLOAD_INVALID',
      'APPLE_EDGE_VERIFIER_DECODE_FAILED','APPLE_EDGE_VERIFIER_VALIDATE_FAILED',
      'APPLE_EDGE_VERIFIER_HEADER_FAILED','APPLE_EDGE_VERIFIER_CHAIN_FAILED',
      'APPLE_EDGE_VERIFIER_KEY_IMPORT_FAILED','APPLE_EDGE_VERIFIER_SIGNATURE_FAILED',
      'APPLE_JOSE_KEY_IMPORT_FAILED','APPLE_JOSE_SIGNATURE_INVALID','APPLE_VERIFICATION_FAILED',
      'APPLE_APP_IDENTIFIER_MISMATCH','APPLE_ENVIRONMENT_MISMATCH',
      'APPLE_ACCOUNT_TOKEN_MISSING','APPLE_BUNDLE_MISMATCH',
      'MALFORMED_TRANSACTION','MISSING_TRANSACTION_ID','INCOMPLETE_APPLE_TRANSACTION',
      'GOOGLE_ACCOUNT_MISMATCH','GOOGLE_PURCHASE_NOT_FOUND','SERVICE_ROLE_REQUIRED',
      'INVALID_PROVIDER','INVALID_ENVIRONMENT','INVALID_SUBSCRIPTION_STATUS','MISSING_PROVIDER_REFERENCE',
      'UNKNOWN_PROVIDER_PRODUCT','LIVE_PAYMENTS_DISABLED','PURCHASE_ALREADY_CLAIMED','MARKET_NOT_FOUND']
      .find((value)=>code.includes(value))??'VERIFICATION_FAILED';
    await recordRefusal(admin,provider,body,safe).catch(()=>{});
    console.error('subscription-sync failed:',safe);
    return reply(safe.endsWith('_NOT_CONFIGURED')?503:safe.includes('MISMATCH')||safe==='PURCHASE_ALREADY_CLAIMED'?403:400,{error:safe});
  }
});

async function recordRefusal(admin:any,provider:string,body:{transaction_jws?:string;purchase_token?:string},detail:string) {
  if (!admin || !['APPLE','GOOGLE_PLAY'].includes(provider)) return;
  const token=provider==='APPLE'?body.transaction_jws:body.purchase_token;
  if (!token) return;
  const digest=await sha256(String(token));
  await admin.from('subscription_provider_events').upsert({
    provider,
    external_event_id:`CLIENT_SYNC_FAILED:${digest}`,
    event_type:'CLIENT_SYNC_FAILED',
    environment:'TEST',
    payload_sha256:digest,
    outcome:'REFUSED',
    detail,
    processed_at:new Date().toISOString(),
  },{onConflict:'provider,external_event_id'});
}
