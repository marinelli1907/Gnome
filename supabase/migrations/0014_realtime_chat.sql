-- 0014_realtime_chat.sql
-- Enable Supabase Realtime for claim-scoped pickup chat.
--
-- The app (useClaimMessagesRealtime) subscribes to INSERTs on claim_messages
-- filtered by claim_id and refreshes the thread instantly. RLS on claim_messages
-- (0004_pickup_chat.sql) already restricts SELECT to the two parties of an
-- approved/completed claim, and Realtime honors that RLS on the stream — so no
-- new policy is needed here; we only add the table to the publication.
--
-- Idempotent: skip if the table is already a member of the publication.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'claim_messages'
  ) then
    alter publication supabase_realtime add table public.claim_messages;
  end if;
end
$$;

-- Ensure UPDATE/DELETE payloads carry enough identity (INSERT is all the app
-- needs today, but this keeps the stream well-formed if that changes).
alter table public.claim_messages replica identity full;
