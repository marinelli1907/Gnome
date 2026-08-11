# AI Action Safety (test-proven 2026-08-10)

- READ_ONLY admin cannot approve (NOT_AUTHORIZED)     [live PASS]
- Kill switch blocks execution while paused           [live PASS]
- Approved action executes exactly once               [live PASS]
- Second execution refused (NOT_APPROVED)             [live PASS]
- Request rows not client-writable (even SUPER: 403)  [live PASS]
- Payload-hash binding: server recomputes sha256(action|parameters) at
  execution; mismatch → FAILED (tamper path requires service role, which
  clients never hold)
- Full audit: approve / execute / pause-resume rows   [live PASS]
- Expiry: requests auto-EXPIRE at review/execute time after 7 days
