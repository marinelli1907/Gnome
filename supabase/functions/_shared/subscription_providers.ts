import 'npm:reflect-metadata@0.2.2';
import { Buffer } from 'node:buffer';
import {
  BasicConstraintsExtension,
  X509Certificate as WebX509Certificate,
} from 'npm:@peculiar/x509@2.0.0';
import {
  AppStoreServerAPIClient,
  Environment,
  OfferType,
  SignedDataVerifier,
  Status,
  VerificationException,
  VerificationStatus,
} from 'npm:@apple/app-store-server-library@3.1.0';
import { compactVerify, importPKCS8, SignJWT } from 'npm:jose@6.1.0';
import { APPLE_ROOT_CA_DER_BASE64 } from './apple_roots.ts';

export const BUNDLE_ID = 'app.boonesystems.gnome';
export const APPLE_APP_ID = 6799531520;
export const STORE_PRODUCTS = new Set(['gnome.pro.monthly','gnome.farm.monthly']);

export type VerifiedSubscription = {
  provider: 'APPLE' | 'GOOGLE_PLAY';
  productId: string;
  externalSubscriptionId: string;
  externalTransactionId: string;
  status: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  startedAt: string | null;
  periodEnd: string | null;
  expiresAt: string | null;
  cancelAtPeriodEnd: boolean;
  eventId: string;
  eventType: string;
  payloadSha256: string;
  purchaseToken?: string;
  purchaseTokenSha256?: string;
  replacesExternalId?: string;
  statusDetail?: string;
};
type AppleStatusTransaction = {
  status?: number;
  signedTransactionInfo?: string;
  signedRenewalInfo?: string;
};
type AppleStatusGroup = { lastTransactions?: AppleStatusTransaction[] };
type AppleStatusResponse = { data?: AppleStatusGroup[] };
export type AppleAuthDiagnosticStatus =
  | 'CONFIGURED'
  | 'INVALID_PRIVATE_KEY_SHAPE'
  | 'AUTH_FAILED'
  | 'AUTH_OK_TRANSACTION_REJECTED'
  | 'UNEXPECTED_ERROR';

const iso = (ms?: number | string | null) => ms ? new Date(typeof ms === 'string' ? ms : ms).toISOString() : null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2,'0')).join('');
}

function decodeUntrustedJwt(jws: string): Record<string, unknown> {
  try {
    const part=jws.split('.')[1];
    if (!part) throw new Error('MALFORMED_TRANSACTION');
    const padded=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=');
    return JSON.parse(atob(padded));
  } catch {
    throw new Error('MALFORMED_TRANSACTION');
  }
}

export function appleStatusLookupIdForTest(hint: Record<string, unknown>): string {
  return String(hint.originalTransactionId??hint.transactionId??'');
}

class EdgeSignedDataVerifier extends SignedDataVerifier {
  private readonly webRoots:WebX509Certificate[];

  constructor(
    appleRootCertificates:Buffer[],
    enableOnlineChecks:boolean,
    environment:Environment,
    bundleId:string,
    appAppleId?:number,
  ) {
    super(appleRootCertificates,enableOnlineChecks,environment,bundleId,appAppleId);
    this.webRoots=appleRootCertificates.map((certificate) =>
      new WebX509Certificate(Uint8Array.from(certificate)));
  }

  protected override async verifyJWT<T>(
    jwt:string,
    validator:{validate(value:T):boolean},
    signedDateExtractor:(decodedJWT:T)=>Date,
  ):Promise<T> {
    let stage='DECODE';
    try {
      const decodedJWT=decodeUntrustedJwt(jwt) as T;
      stage='VALIDATE';
      if (!validator.validate(decodedJWT)) {
        throw new VerificationException(VerificationStatus.FAILURE);
      }
      if (this.environment===Environment.XCODE || this.environment===Environment.LOCAL_TESTING) {
        return decodedJWT;
      }
      let certificateChain:WebX509Certificate[];
      try {
        stage='HEADER';
        const encodedHeader=jwt.split('.')[0];
        const header=JSON.parse(Buffer.from(encodedHeader,'base64url').toString('utf8')) as {
          alg?:string;
          x5c?:string[];
        };
        if (header.alg!=='ES256' || header.x5c?.length!==3) {
          throw new VerificationException(VerificationStatus.INVALID_CHAIN_LENGTH);
        }
        certificateChain=header.x5c.slice(0,2).map((certificate) =>
          new WebX509Certificate(Uint8Array.from(Buffer.from(certificate,'base64'))));
      } catch (error) {
        if (error instanceof VerificationException) throw error;
        throw new VerificationException(
          VerificationStatus.INVALID_CERTIFICATE,
          error instanceof Error ? error : undefined,
        );
      }
      const effectiveDate=this.enableOnlineChecks?new Date():signedDateExtractor(decodedJWT);
      stage='CHAIN';
      const [leaf,intermediate]=certificateChain;
      const validAt=(certificate:WebX509Certificate) =>
        certificate.notBefore.getTime()<=effectiveDate.getTime()
        && certificate.notAfter.getTime()>=effectiveDate.getTime();
      let trustedRoot:WebX509Certificate|null=null;
      for (const root of this.webRoots) {
        if (intermediate.issuer!==root.subject || !validAt(root)) continue;
        if (await intermediate.verify({publicKey:root.publicKey,date:effectiveDate})) {
          trustedRoot=root;
          break;
        }
      }
      const intermediateConstraints=intermediate.getExtension(BasicConstraintsExtension);
      const validChain=Boolean(trustedRoot)
        && leaf.issuer===intermediate.subject
        && validAt(leaf)
        && intermediateConstraints?.ca===true
        && leaf.getExtension('1.2.840.113635.100.6.11.1')!==null
        && intermediate.getExtension('1.2.840.113635.100.6.2.1')!==null
        && await leaf.verify({publicKey:intermediate.publicKey,date:effectiveDate});
      if (!validChain) throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
      stage='KEY_IMPORT';
      const verificationKey=await leaf.publicKey.export(
        {name:'ECDSA',namedCurve:'P-256'},
        ['verify'],
      );
      try {
        stage='SIGNATURE';
        await compactVerify(jwt,verificationKey,{algorithms:['ES256']});
      } catch {
        throw new Error('APPLE_JOSE_SIGNATURE_INVALID');
      }
      return decodedJWT;
    } catch (error) {
      if (error instanceof VerificationException) throw error;
      throw new VerificationException(
        VerificationStatus.VERIFICATION_FAILURE,
        new Error(`APPLE_EDGE_VERIFIER_${stage}_FAILED`,{
          cause:error instanceof Error ? error : undefined,
        }),
      );
    }
  }
}

function appleConfig(environment: Environment) {
  const {privateKey,keyId,issuer}=appleCredentials();
  const roots=APPLE_ROOT_CA_DER_BASE64.map((value) => Buffer.from(value,'base64'));
  return {
    client:new AppStoreServerAPIClient(privateKey,keyId,issuer,BUNDLE_ID,environment),
    // Supabase Edge cannot reliably reach Apple's OCSP endpoints. Offline mode still
    // verifies Apple's certificate chain and JWS signature at the payload signing date.
    verifier:new EdgeSignedDataVerifier(roots,false,environment,BUNDLE_ID,environment===Environment.PRODUCTION?APPLE_APP_ID:undefined),
  };
}

function appleCredentials() {
  const issuer=Deno.env.get('APPLE_IAP_ISSUER_ID')?.trim();
  const keyId=Deno.env.get('APPLE_IAP_KEY_ID')?.trim();
  const privateKey=Deno.env.get('APPLE_IAP_PRIVATE_KEY')?.replace(/\\n/g,'\n').trim();
  if (!issuer || !keyId || !privateKey) throw new Error('APPLE_SERVER_NOT_CONFIGURED');
  return {issuer,keyId,privateKey};
}

async function appleBearerToken(): Promise<string> {
  const {issuer,keyId,privateKey}=appleCredentials();
  const now=Math.floor(Date.now()/1000);
  const key=await importPKCS8(privateKey,'ES256');
  return await new SignJWT({bid:BUNDLE_ID})
    .setProtectedHeader({alg:'ES256',kid:keyId,typ:'JWT'})
    .setIssuer(issuer).setAudience('appstoreconnect-v1')
    .setIssuedAt(now).setExpirationTime(now+300).sign(key);
}

function appleApiBase(environment: Environment): string {
  return environment===Environment.PRODUCTION
    ? 'https://api.storekit.apple.com'
    : 'https://api.storekit-sandbox.apple.com';
}

async function appleApiRequest<T>(
  environment: Environment,
  path: string,
  method: 'GET'|'POST',
  fallback: string,
): Promise<T> {
  let response:Response;
  try {
    response=await fetch(`${appleApiBase(environment)}${path}`,{
      method,
      headers:{Authorization:`Bearer ${await appleBearerToken()}`,Accept:'application/json'},
    });
  } catch {
    throw new Error('APPLE_API_UNAVAILABLE');
  }
  if (!response.ok) {
    const body=await response.json().catch(()=>({})) as {errorCode?:number};
    throw safeAppleApiError({httpStatusCode:response.status,apiError:Number(body.errorCode??0)},fallback);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error('APPLE_API_RESPONSE_INVALID');
  }
}

const appleApiGet=<T>(environment:Environment,path:string,fallback:string) =>
  appleApiRequest<T>(environment,path,'GET',fallback);

const appleApiPost=<T>(environment:Environment,path:string,fallback:string) =>
  appleApiRequest<T>(environment,path,'POST',fallback);

async function getAppleSubscriptionStatuses(environment: Environment, statusLookupId: string): Promise<AppleStatusResponse> {
  const body=await appleApiGet<AppleStatusResponse>(environment,
    `/inApps/v1/subscriptions/${encodeURIComponent(statusLookupId)}`,'APPLE_STATUS_LOOKUP_FAILED');
  if (!Array.isArray(body.data)) throw new Error('APPLE_STATUS_RESPONSE_INVALID');
  return body;
}

export async function diagnoseAppleServerAuth(): Promise<AppleAuthDiagnosticStatus> {
  const rawPrivateKey=Deno.env.get('APPLE_IAP_PRIVATE_KEY') ?? '';
  const privateKey=rawPrivateKey.replace(/\\n/g,'\n').trim();
  if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
    || !privateKey.endsWith('-----END PRIVATE KEY-----')
    || !privateKey.includes('\n')) {
    return 'INVALID_PRIVATE_KEY_SHAPE';
  }
  try {
    appleCredentials();
    await getAppleSubscriptionStatuses(Environment.SANDBOX,'999999999999999');
    return 'AUTH_OK_TRANSACTION_REJECTED';
  } catch (error) {
    const known=appleKnownError(error);
    if (known?.message==='APPLE_API_AUTH_FAILED') return 'AUTH_FAILED';
    if (known?.message==='APPLE_SERVER_NOT_CONFIGURED') return 'INVALID_PRIVATE_KEY_SHAPE';
    if (known) return 'AUTH_OK_TRANSACTION_REJECTED';
    const value=error as { statusCode?: number; httpStatusCode?: number; response?: { status?: number }; apiError?: number | null };
    const status=Number(value?.httpStatusCode ?? value?.statusCode ?? value?.response?.status ?? 0);
    const apiError=Number(value?.apiError ?? 0);
    if (status===401 || status===403) return 'AUTH_FAILED';
    if (status>=400 || apiError) {
      return 'AUTH_OK_TRANSACTION_REJECTED';
    }
    return 'UNEXPECTED_ERROR';
  }
}

export async function diagnoseAppleNotificationPipeline(): Promise<string> {
  try {
    const requested=await appleApiPost<{testNotificationToken?:string}>(Environment.SANDBOX,
      '/inApps/v1/notifications/test','APPLE_TEST_NOTIFICATION_REQUEST_FAILED');
    const token=String(requested.testNotificationToken??'');
    if (!token) return 'TEST_NOTIFICATION_TOKEN_MISSING';
    for (let attempt=0;attempt<10;attempt+=1) {
      if (attempt>0) await new Promise((resolve)=>setTimeout(resolve,2_000));
      let status:{signedPayload?:string;sendAttempts?:Array<{sendAttemptResult?:string}>};
      try {
        status=await appleApiGet(Environment.SANDBOX,
          `/inApps/v1/notifications/test/${encodeURIComponent(token)}`,'APPLE_TEST_NOTIFICATION_STATUS_FAILED');
      } catch (error) {
        if (appleKnownError(error)?.message==='APPLE_TRANSACTION_NOT_FOUND') continue;
        throw error;
      }
      const signedPayload=String(status.signedPayload??'');
      if (!signedPayload) continue;
      const deliveryResult=String(status.sendAttempts?.[0]?.sendAttemptResult??'UNKNOWN');
      const safeDeliveryResult=[
        'SUCCESS','CIRCULAR_REDIRECT','INVALID_RESPONSE','NO_RESPONSE','OTHER','PREMATURE_CLOSE',
        'SOCKET_ISSUE','TIMED_OUT','TLS_ISSUE','UNSUCCESSFUL_HTTP_RESPONSE_CODE','UNSUPPORTED_CHARSET',
      ].includes(deliveryResult) ? deliveryResult : 'UNKNOWN';
      let firstError:Error|null=null;
      for (const environment of [Environment.SANDBOX,Environment.PRODUCTION]) {
        try {
          const {verifier}=appleConfig(environment);
          const notification=await verifier.verifyAndDecodeNotification(signedPayload);
          return String(notification.notificationType??'')==='TEST'
            ? `SIGNED_TEST_NOTIFICATION_VERIFIED_WEBHOOK_${safeDeliveryResult}`
            : 'SIGNED_NOTIFICATION_TYPE_INVALID';
        } catch (error) {
          const safe=safeAppleSignedDataError(error,'APPLE_NOTIFICATION_VERIFICATION_FAILED');
          if (!firstError || safe.message!=='APPLE_ENVIRONMENT_MISMATCH') firstError=safe;
        }
      }
      return firstError?.message??'APPLE_NOTIFICATION_VERIFICATION_FAILED';
    }
    return 'TEST_NOTIFICATION_PENDING';
  } catch (error) {
    return appleKnownError(error)?.message??'UNEXPECTED_ERROR';
  }
}

function appleKnownError(error: unknown): Error | null {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error;
  return null;
}

function safeAppleApiError(error: unknown, fallback: string): Error {
  const known=appleKnownError(error);
  if (known) return known;
  const value = error as { statusCode?: number; httpStatusCode?: number; response?: { status?: number }; apiError?: number | null };
  const status = Number(value?.httpStatusCode ?? value?.statusCode ?? value?.response?.status ?? 0);
  const apiError=Number(value?.apiError ?? 0);
  if (status===401 || status===403) return new Error('APPLE_API_AUTH_FAILED');
  if (apiError===4040001) return new Error('APPLE_ACCOUNT_NOT_FOUND');
  if (apiError===4040003 || apiError===4040004) return new Error('APPLE_APP_NOT_FOUND');
  if (apiError===4040005 || apiError===4040006) return new Error('APPLE_ORIGINAL_TRANSACTION_NOT_FOUND');
  if (apiError===4040010) return new Error('APPLE_TRANSACTION_NOT_FOUND');
  if (apiError===4000002) return new Error('APPLE_APP_IDENTIFIER_INVALID');
  if (apiError===4000006 || apiError===4000008) return new Error('APPLE_TRANSACTION_ID_INVALID');
  if (apiError===4000187) return new Error('APPLE_TRANSACTION_ID_NOT_ORIGINAL');
  if (status===404) return new Error('APPLE_TRANSACTION_NOT_FOUND');
  if (status===429) return new Error('APPLE_API_RATE_LIMITED');
  if (status>=500) return new Error('APPLE_API_UNAVAILABLE');
  return new Error(fallback);
}

function safeAppleSignedDataError(error: unknown, fallback: string): Error {
  const known=appleKnownError(error);
  if (known) return known;
  const value=error as { status?: number; cause?: unknown };
  const status=Number(value?.status ?? -1);
  if (status===2) return new Error('APPLE_SIGNED_DATA_RETRYABLE_VERIFICATION_FAILED');
  if (status===3) return new Error('APPLE_APP_IDENTIFIER_MISMATCH');
  if (status===4) return new Error('APPLE_ENVIRONMENT_MISMATCH');
  if (status===5) return new Error('APPLE_CERTIFICATE_CHAIN_LENGTH_INVALID');
  if (status===6) return new Error('APPLE_CERTIFICATE_INVALID');
  if (status===1) {
    if (value.cause instanceof Error && [
      'APPLE_JOSE_KEY_IMPORT_FAILED','APPLE_JOSE_SIGNATURE_INVALID',
    ].includes(value.cause.message)) return new Error(value.cause.message);
    if (value.cause instanceof Error && /^APPLE_EDGE_VERIFIER_[A-Z_]+_FAILED$/.test(value.cause.message)) {
      return new Error(value.cause.message);
    }
    return value.cause instanceof Error
      ? new Error('APPLE_SIGNATURE_VERIFICATION_FAILED')
      : new Error('APPLE_CERTIFICATE_CHAIN_VERIFICATION_FAILED');
  }
  if (status===7) return new Error('APPLE_SIGNED_PAYLOAD_INVALID');
  return new Error(fallback);
}

function appleStatus(status?: number): string {
  if (status===Status.ACTIVE) return 'active';
  if (status===Status.EXPIRED) return 'expired';
  if (status===Status.BILLING_RETRY) return 'billing_retry';
  if (status===Status.BILLING_GRACE_PERIOD) return 'grace_period';
  if (status===Status.REVOKED) return 'revoked';
  return 'incomplete';
}

export function appleStatusWithOffer(status: string, offerType?: number): string {
  return status==='active' && Number(offerType)===OfferType.INTRODUCTORY_OFFER
    ? 'trialing'
    : status;
}

type AppleDecodedTransaction = {
  originalTransactionId?: string;
  transactionId?: string;
  productId?: string;
  appAccountToken?: string;
  bundleId?: string;
  environment?: string;
  originalPurchaseDate?: number;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  offerType?: number;
};

function assertAppleTransactionForAccount(transaction: AppleDecodedTransaction, expectedUserId: string) {
  if (!transaction.originalTransactionId || !transaction.transactionId || !transaction.productId) {
    throw new Error('INCOMPLETE_APPLE_TRANSACTION');
  }
  if (!STORE_PRODUCTS.has(String(transaction.productId))) throw new Error('UNKNOWN_PROVIDER_PRODUCT');
  if (!transaction.appAccountToken) throw new Error('APPLE_ACCOUNT_TOKEN_MISSING');
  if (String(transaction.appAccountToken).toLowerCase()!==expectedUserId.toLowerCase()) {
    throw new Error('APPLE_ACCOUNT_MISMATCH');
  }
}

function assertAppleApiTransaction(
  transaction: AppleDecodedTransaction,
  expectedUserId: string,
  environment: Environment,
  requestedTransactionId: string,
) {
  assertAppleTransactionForAccount(transaction,expectedUserId);
  if (transaction.bundleId!==BUNDLE_ID) throw new Error('APPLE_BUNDLE_MISMATCH');
  const expectedEnvironment=environment===Environment.PRODUCTION?'production':'sandbox';
  if (String(transaction.environment??'').toLowerCase()!==expectedEnvironment) {
    throw new Error('APPLE_ENVIRONMENT_MISMATCH');
  }
  if (transaction.transactionId!==requestedTransactionId && transaction.originalTransactionId!==requestedTransactionId) {
    throw new Error('APPLE_TRANSACTION_ID_MISMATCH');
  }
}

async function getAppleTransactionInfo(
  environment: Environment,
  transactionId: string,
  expectedUserId: string,
): Promise<{transaction:AppleDecodedTransaction;signedTransactionInfo:string}> {
  try {
    const response=await appleApiGet<{signedTransactionInfo?:string}>(environment,
      `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,'APPLE_TRANSACTION_LOOKUP_FAILED');
    const signedTransactionInfo=String(response.signedTransactionInfo??'');
    if (!signedTransactionInfo) throw new Error('APPLE_TRANSACTION_RESPONSE_INVALID');
    const transaction=decodeUntrustedJwt(signedTransactionInfo) as AppleDecodedTransaction;
    assertAppleApiTransaction(transaction,expectedUserId,environment,transactionId);
    return {transaction,signedTransactionInfo};
  } catch (error) {
    throw safeAppleApiError(error,'APPLE_TRANSACTION_LOOKUP_FAILED');
  }
}

function appleStatusFromSignedTransaction(transaction: AppleDecodedTransaction): string {
  if (transaction.revocationDate) return 'revoked';
  const expires=Number(transaction.expiresDate??0);
  if (!Number.isFinite(expires) || expires<=0) return 'incomplete';
  if (expires<=Date.now()) return 'expired';
  return Number(transaction.offerType)===OfferType.INTRODUCTORY_OFFER ? 'trialing' : 'active';
}

function verifiedAppleFromSignedTransaction(
  transaction: AppleDecodedTransaction,
  environment: Environment,
  signedTransactionInfo: string,
  status: string,
  eventSuffix: string,
): Promise<VerifiedSubscription> {
  const environmentName=environment===Environment.PRODUCTION?'PRODUCTION':'SANDBOX';
  const verified:VerifiedSubscription={
    provider:'APPLE',productId:String(transaction.productId),externalSubscriptionId:String(transaction.originalTransactionId),
    externalTransactionId:String(transaction.transactionId),status,environment:environmentName,
    startedAt:iso(transaction.originalPurchaseDate??transaction.purchaseDate),periodEnd:iso(transaction.expiresDate),
    expiresAt:iso(transaction.expiresDate),cancelAtPeriodEnd:false,
    eventId:`APPLE:${String(transaction.transactionId)}:${eventSuffix}`,
    eventType:'CLIENT_SYNC',payloadSha256:'',
    statusDetail:eventSuffix,
  };
  return Promise.resolve(sha256(signedTransactionInfo)).then((payloadSha256) => ({...verified,payloadSha256}));
}

export async function verifyAppleTransaction(jws: string, expectedUserId: string): Promise<VerifiedSubscription> {
  const hint=decodeUntrustedJwt(jws);
  const statusLookupId=appleStatusLookupIdForTest(hint);
  if (!statusLookupId) throw new Error('MISSING_TRANSACTION_ID');
  const hintedProduct=String(hint.productId??'');
  if (hintedProduct && !STORE_PRODUCTS.has(hintedProduct)) throw new Error('UNKNOWN_PROVIDER_PRODUCT');
  const hintedBundle=String(hint.bundleId??'');
  if (hintedBundle && hintedBundle!==BUNDLE_ID) throw new Error('APPLE_BUNDLE_MISMATCH');
  const hintedAccount=String(hint.appAccountToken??'').toLowerCase();
  if (hintedAccount && hintedAccount!==expectedUserId.toLowerCase()) throw new Error('APPLE_ACCOUNT_MISMATCH');
  const hinted=String(hint.environment??'').toLowerCase();
  const attempts=hinted==='production'
    ? [Environment.PRODUCTION,Environment.SANDBOX]
    : [Environment.SANDBOX,Environment.PRODUCTION];
  let lastError: unknown;
  let signedBase:{
    environment:Environment;
    transaction:AppleDecodedTransaction;
    signedTransactionInfo:string;
    source:'SIGNED_TRANSACTION'|'APPLE_API_TRANSACTION_INFO';
  }|null=null;

  for (const environment of attempts) {
    try {
      const {verifier}=appleConfig(environment);
      const transaction=await verifier.verifyAndDecodeTransaction(jws) as AppleDecodedTransaction;
      assertAppleTransactionForAccount(transaction,expectedUserId);
      signedBase={environment,transaction,signedTransactionInfo:jws,source:'SIGNED_TRANSACTION'};
      break;
    } catch (error) {
      lastError=safeAppleSignedDataError(error,'APPLE_SIGNED_DATA_VERIFICATION_FAILED');
      if (error instanceof Error && [
        'APPLE_ACCOUNT_MISMATCH','APPLE_ACCOUNT_TOKEN_MISSING','APPLE_BUNDLE_MISMATCH',
        'UNKNOWN_PROVIDER_PRODUCT','INCOMPLETE_APPLE_TRANSACTION',
      ].includes(error.message)) throw error;
    }
  }

  if (!signedBase) {
    let apiError:unknown;
    for (const environment of attempts) {
      try {
        const result=await getAppleTransactionInfo(environment,statusLookupId,expectedUserId);
        signedBase={environment,...result,source:'APPLE_API_TRANSACTION_INFO'};
        break;
      } catch (error) {
        apiError=error;
        if (error instanceof Error && [
          'APPLE_ACCOUNT_MISMATCH','APPLE_ACCOUNT_TOKEN_MISSING','APPLE_BUNDLE_MISMATCH',
          'APPLE_ENVIRONMENT_MISMATCH','APPLE_TRANSACTION_ID_MISMATCH','UNKNOWN_PROVIDER_PRODUCT',
          'INCOMPLETE_APPLE_TRANSACTION',
        ].includes(error.message)) throw error;
      }
    }
    if (!signedBase) {
      throw apiError instanceof Error
        ? apiError
        : lastError instanceof Error
          ? lastError
          : new Error('APPLE_TRANSACTION_LOOKUP_FAILED');
    }
  }

  for (const environment of [signedBase.environment]) {
    try {
      const {client,verifier}=appleConfig(environment);
      void client;
      const response=await getAppleSubscriptionStatuses(environment,statusLookupId).catch((error) => {
        throw safeAppleApiError(error,'APPLE_STATUS_LOOKUP_FAILED');
      });
      const items=(response.data??[]).flatMap((group) => group.lastTransactions??[]);
      const decoded=await Promise.all(items.filter((item) => item.signedTransactionInfo).map(async (item) => {
        try {
          return {
            item,
            transaction:await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo!),
            renewal:item.signedRenewalInfo?await verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo):null,
          };
        } catch (error) {
          throw safeAppleSignedDataError(error,'APPLE_SIGNED_DATA_VERIFICATION_FAILED');
        }
      }));
      const candidates=decoded.filter(({transaction}) => STORE_PRODUCTS.has(String(transaction.productId??'')));
      candidates.sort((a,b) => Number(b.transaction.expiresDate??0)-Number(a.transaction.expiresDate??0));
      const current=candidates[0];
      if (!current) throw new Error('UNKNOWN_PROVIDER_PRODUCT');
      const t=current.transaction;
      assertAppleTransactionForAccount(t as AppleDecodedTransaction,expectedUserId);
      const status=appleStatusWithOffer(appleStatus(Number(current.item.status)),Number(t.offerType));
      const environmentName=environment===Environment.PRODUCTION?'PRODUCTION':'SANDBOX';
      const payload=`${current.item.signedTransactionInfo}.${current.item.signedRenewalInfo??''}`;
      return {
        provider:'APPLE',productId:String(t.productId),externalSubscriptionId:String(t.originalTransactionId),
        externalTransactionId:String(t.transactionId),status,environment:environmentName,
        startedAt:iso(t.originalPurchaseDate??t.purchaseDate),periodEnd:iso(t.expiresDate),expiresAt:iso(
          status==='grace_period' ? current.renewal?.gracePeriodExpiresDate??t.expiresDate : t.expiresDate),
        cancelAtPeriodEnd:current.renewal?.autoRenewStatus===0,eventId:`APPLE:${t.transactionId}:${current.item.status}`,
        eventType:'CLIENT_SYNC',payloadSha256:await sha256(payload),
        statusDetail:current.renewal?.isInBillingRetryPeriod?'BILLING_RETRY':undefined,
      };
    } catch (error) {
      lastError=appleKnownError(error) ?? new Error('APPLE_VERIFICATION_FAILED');
      if (error instanceof Error && [
        'APPLE_ACCOUNT_MISMATCH','APPLE_ACCOUNT_TOKEN_MISSING','APPLE_BUNDLE_MISMATCH',
        'UNKNOWN_PROVIDER_PRODUCT',
      ].includes(error.message)) throw error;
    }
  }

  const signedStatus=appleStatusFromSignedTransaction(signedBase.transaction);
  return verifiedAppleFromSignedTransaction(
    signedBase.transaction,
    signedBase.environment,
    signedBase.signedTransactionInfo,
    signedStatus,
    lastError instanceof Error ? `${signedBase.source}_WITH_${lastError.message}` : signedBase.source,
  );
}

export function appleNotificationStatus(type:string,subtype:string,rawStatus:number|undefined,revoked:boolean):string {
  if (revoked || type==='REVOKE') return 'revoked';
  if (type==='REFUND') return 'refunded';
  if (type==='EXPIRED' || type==='GRACE_PERIOD_EXPIRED') return 'expired';
  if (type==='DID_FAIL_TO_RENEW') return subtype==='GRACE_PERIOD'?'grace_period':'billing_retry';
  const status=appleStatus(rawStatus);
  if (status!=='incomplete') return status;
  if (['SUBSCRIBED','DID_RENEW','OFFER_REDEEMED','DID_CHANGE_RENEWAL_STATUS','RENEWAL_EXTENDED'].includes(type)) return 'active';
  return status;
}

export async function verifyAppleNotification(signedPayload: string): Promise<
  {verified:VerifiedSubscription;userId:string|null;test:false}|{verified:null;userId:null;test:true}
> {
  const hint=decodeUntrustedJwt(signedPayload);
  const hinted=String((hint.data as Record<string,unknown>|undefined)?.environment??'').toLowerCase();
  const attempts=hinted==='production'
    ? [Environment.PRODUCTION,Environment.SANDBOX]
    : [Environment.SANDBOX,Environment.PRODUCTION];
  let lastError:unknown;
  for (const environment of attempts) {
    try {
      const {verifier}=appleConfig(environment);
      const notification=await verifier.verifyAndDecodeNotification(signedPayload);
      const notificationType=String(notification.notificationType??'SERVER_NOTIFICATION');
      const subtype=String(notification.subtype??'');
      if (notificationType==='TEST') return {verified:null,userId:null,test:true};
      const signedTransaction=notification.data?.signedTransactionInfo;
      if (!signedTransaction) throw new Error('APPLE_NOTIFICATION_WITHOUT_TRANSACTION');
      const transaction=await verifier.verifyAndDecodeTransaction(signedTransaction);
      const renewal=notification.data?.signedRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo):null;
      const rawUserId=String(transaction.appAccountToken??'').toLowerCase();
      const userId=UUID_RE.test(rawUserId)?rawUserId:null;
      if (!transaction.originalTransactionId || !transaction.transactionId || !transaction.productId || !STORE_PRODUCTS.has(transaction.productId)) {
        throw new Error('INCOMPLETE_APPLE_TRANSACTION');
      }
      const rawStatus=notification.data?.status==null?undefined:Number(notification.data.status);
      const status=appleStatusWithOffer(
        appleNotificationStatus(notificationType,subtype,rawStatus,Boolean(transaction.revocationDate)),
        Number(transaction.offerType),
      );
      const environmentName=environment===Environment.PRODUCTION?'PRODUCTION':'SANDBOX';
      return {userId,verified:{
        provider:'APPLE',productId:transaction.productId,externalSubscriptionId:transaction.originalTransactionId,
        externalTransactionId:transaction.transactionId,status,environment:environmentName,
        startedAt:iso(transaction.originalPurchaseDate??transaction.purchaseDate),periodEnd:iso(transaction.expiresDate),
        expiresAt:iso(status==='grace_period'?renewal?.gracePeriodExpiresDate??transaction.expiresDate:transaction.expiresDate),
        cancelAtPeriodEnd:renewal?.autoRenewStatus===0,
        eventId:`APPLE:${String(notification.notificationUUID??transaction.transactionId)}`,
        eventType:notificationType,payloadSha256:await sha256(signedPayload),
        statusDetail:subtype||notificationType,
      },test:false};
    } catch (error) { lastError=safeAppleSignedDataError(error,'APPLE_NOTIFICATION_VERIFICATION_FAILED'); }
  }
  throw lastError instanceof Error?lastError:new Error('APPLE_NOTIFICATION_VERIFICATION_FAILED');
}

type ServiceAccount = { client_email:string; private_key:string; token_uri?:string };
let googleToken:{value:string;expiresAt:number}|null=null;
async function googleAccessToken(): Promise<string> {
  if (googleToken && googleToken.expiresAt>Date.now()+60_000) return googleToken.value;
  const raw=Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_PLAY_SERVER_NOT_CONFIGURED');
  const account=JSON.parse(raw) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error('GOOGLE_PLAY_SERVER_NOT_CONFIGURED');
  const now=Math.floor(Date.now()/1000);
  const key=await importPKCS8(account.private_key.replace(/\\n/g,'\n'),'RS256');
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/androidpublisher'})
    .setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(account.client_email)
    .setAudience(account.token_uri??'https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now+3600).sign(key);
  const response=await fetch(account.token_uri??'https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  });
  if (!response.ok) throw new Error('GOOGLE_PLAY_AUTH_FAILED');
  const body=await response.json() as {access_token?:string;expires_in?:number};
  if (!body.access_token) throw new Error('GOOGLE_PLAY_AUTH_FAILED');
  googleToken={value:body.access_token,expiresAt:Date.now()+Number(body.expires_in??3600)*1000};
  return googleToken.value;
}

function googleStatus(value: string): string {
  return ({
    SUBSCRIPTION_STATE_PENDING:'pending',SUBSCRIPTION_STATE_ACTIVE:'active',
    SUBSCRIPTION_STATE_PAUSED:'paused',SUBSCRIPTION_STATE_IN_GRACE_PERIOD:'grace_period',
    SUBSCRIPTION_STATE_ON_HOLD:'billing_retry',SUBSCRIPTION_STATE_CANCELED:'canceled',
    SUBSCRIPTION_STATE_EXPIRED:'expired',SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED:'canceled',
  } as Record<string,string>)[value]??'incomplete';
}

export async function verifyGooglePurchase(purchaseToken: string, expectedUserId: string): Promise<VerifiedSubscription> {
  if (!purchaseToken || purchaseToken.length>4096) throw new Error('INVALID_PURCHASE_TOKEN');
  const accessToken=await googleAccessToken();
  const url=`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(BUNDLE_ID)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});
  if (!response.ok) throw new Error(response.status===404?'GOOGLE_PURCHASE_NOT_FOUND':'GOOGLE_PLAY_VERIFICATION_FAILED');
  const body=await response.json() as Record<string,any>;
  const expectedAccount=await sha256(expectedUserId.toLowerCase());
  if (body.externalAccountIdentifiers?.obfuscatedExternalAccountId!==expectedAccount) throw new Error('GOOGLE_ACCOUNT_MISMATCH');
  const lineItems=(body.lineItems??[]).filter((item:Record<string,unknown>) => STORE_PRODUCTS.has(String(item.productId??'')));
  lineItems.sort((a:Record<string,any>,b:Record<string,any>) => Date.parse(b.expiryTime??0)-Date.parse(a.expiryTime??0));
  const item=lineItems[0];
  if (!item?.productId) throw new Error('UNKNOWN_PROVIDER_PRODUCT');
  const tokenHash=await sha256(purchaseToken);
  const linkedHash=body.linkedPurchaseToken?await sha256(String(body.linkedPurchaseToken)):undefined;
  const status=googleStatus(String(body.subscriptionState??''));
  const expires=iso(item.expiryTime);
  const isTest=Boolean(body.testPurchase);
  return {
    provider:'GOOGLE_PLAY',productId:String(item.productId),externalSubscriptionId:tokenHash,
    externalTransactionId:String(body.latestOrderId??tokenHash),status,
    environment:isTest?'SANDBOX':'PRODUCTION',startedAt:iso(body.startTime),periodEnd:expires,expiresAt:expires,
    cancelAtPeriodEnd:item.autoRenewingPlan?.autoRenewEnabled===false,
    eventId:`GOOGLE_PLAY:${String(body.latestOrderId??tokenHash)}:${String(body.subscriptionState??'UNKNOWN')}:${expires??''}`,
    eventType:'CLIENT_SYNC',payloadSha256:await sha256(JSON.stringify(body)),purchaseToken,
    purchaseTokenSha256:tokenHash,replacesExternalId:linkedHash,statusDetail:String(body.subscriptionState??''),
  };
}
