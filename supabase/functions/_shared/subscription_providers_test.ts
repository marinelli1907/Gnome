import { assertEquals } from 'jsr:@std/assert@1';
import {
  appleNotificationStatus,
  appleStatusLookupIdForTest,
  appleStatusWithOffer,
} from './subscription_providers.ts';

Deno.test('Apple terminal notifications revoke access', () => {
  assertEquals(appleNotificationStatus('REFUND','',1,false),'refunded');
  assertEquals(appleNotificationStatus('REVOKE','',1,false),'revoked');
  assertEquals(appleNotificationStatus('DID_RENEW','',1,true),'revoked');
  assertEquals(appleNotificationStatus('EXPIRED','',1,false),'expired');
});

Deno.test('Apple recovery states retain only intended access', () => {
  assertEquals(appleNotificationStatus('DID_FAIL_TO_RENEW','GRACE_PERIOD',undefined,false),'grace_period');
  assertEquals(appleNotificationStatus('DID_FAIL_TO_RENEW','',undefined,false),'billing_retry');
  assertEquals(appleNotificationStatus('DID_RENEW','',undefined,false),'active');
});

Deno.test('Apple subscription status lookup uses original transaction id', () => {
  assertEquals(appleStatusLookupIdForTest({
    originalTransactionId:'original-transaction',
    transactionId:'latest-transaction',
  }),'original-transaction');
  assertEquals(appleStatusLookupIdForTest({transactionId:'latest-transaction'}),'latest-transaction');
});

Deno.test('Apple introductory offers remain distinguishable from paid active periods', () => {
  assertEquals(appleStatusWithOffer('active',1),'trialing');
  assertEquals(appleStatusWithOffer('active',2),'active');
  assertEquals(appleStatusWithOffer('expired',1),'expired');
});
