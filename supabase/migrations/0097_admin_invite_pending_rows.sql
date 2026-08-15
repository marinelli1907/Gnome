-- 0094's invite flow stores a pending invitation as an admin_users row that has
-- an email but no account yet — user_id is filled in when the invitee signs in
-- and accepts. Production has admin_users.user_id NOT NULL, so that row could
-- never be written and admin_invite_teammate failed outright. The local fixture
-- had the column nullable, so the tests never saw it.
--
-- Making it nullable is the whole fix, and it does not widen access: every
-- authorization check matches user_id against auth.uid(), and NULL never equals
-- anything. A pending invitation therefore grants nothing until it is accepted.

alter table public.admin_users alter column user_id drop not null;

-- But a row with neither an account nor an email is just an orphan that no one
-- can ever claim, so keep the pair honest.
do $$ begin
  alter table public.admin_users add constraint admin_users_identity_chk
    check (user_id is not null or invited_email is not null);
exception when duplicate_object then null; end $$;

-- An accepted invitation must not be re-claimable by a second account, and two
-- pending invitations must not race to the same email.
create unique index if not exists admin_users_one_pending_invite
  on public.admin_users (lower(invited_email))
  where user_id is null and status = 'invited';

notify pgrst, 'reload schema';
