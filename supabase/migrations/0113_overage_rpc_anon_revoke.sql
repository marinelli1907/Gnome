-- 0113: my_overage_required is for signed-in sellers, not the anon key.
--
-- 0106 granted the function to authenticated but never revoked the EXECUTE that Postgres gives
-- PUBLIC on every new function, so the anon role could call it. Harmless in practice — with no
-- auth.uid() it returns an empty set, verified against production during the deployment pass —
-- but it is the same default-PUBLIC trap 0109 closed for the admin promo RPCs, and the only
-- caller (the mobile $0.99 purchase flow) always runs with a user session. Close it the same way.

revoke execute on function public.my_overage_required(uuid) from public, anon;
grant  execute on function public.my_overage_required(uuid) to authenticated;

-- Self-check, in the 0107 style: fail the apply loudly if the grants came out wrong.
do $$
begin
  if has_function_privilege('anon', 'public.my_overage_required(uuid)', 'execute') then
    raise exception '0113: anon can still execute my_overage_required';
  end if;
  if not has_function_privilege('authenticated', 'public.my_overage_required(uuid)', 'execute') then
    raise exception '0113: authenticated lost execute on my_overage_required';
  end if;
end $$;

notify pgrst, 'reload schema';
