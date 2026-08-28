-- Definition-level public-schema fingerprint for read-only drift comparison.
-- Run with tuples-only output when comparing environments:
--   psql ... -At -f supabase/tests/schema_fingerprint.sql

-- Make deparsed defaults, policies, constraints, and views independent of the
-- connecting role's search_path.
set search_path = public, pg_catalog;

with signatures(kind, signature) as (
  select 'column',
         format('%s|%s|%s|%s|%s|%s|%s',
           c.relname, a.attnum, a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod),
           a.attnotnull,
           coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
           a.attidentity::text || a.attgenerated::text)
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and a.attnum > 0
    and not a.attisdropped

  union all
  select 'constraint',
         format('%s|%s|%s|%s', c.relname, con.conname, con.contype,
           pg_get_constraintdef(con.oid, true))
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all
  select 'index', format('%s|%s|%s', tablename, indexname, indexdef)
  from pg_indexes
  where schemaname = 'public'

  union all
  select 'routine',
         format('%s|%s|%s|%s|%s|%s|%s|%s|%s',
           p.oid::regprocedure::text,
           pg_get_function_result(p.oid),
           l.lanname,
           p.provolatile,
           p.proisstrict,
           p.prosecdef,
           p.proparallel,
           coalesce(p.proconfig::text, ''),
           regexp_replace(
             regexp_replace(
               regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),
               '--[^\n]*', '', 'g'),
             '[[:space:]]', '', 'g'))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'

  union all
  select 'policy',
         format('%s|%s|%s|%s|%s|%s',
           c.relname, pol.polname, pol.polcmd,
           (select string_agg(r.rolname, ',' order by r.rolname)
              from unnest(pol.polroles) role_oid
              join pg_roles r on r.oid = role_oid),
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''),
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all
  select 'trigger',
         format('%s|%s|%s', c.relname, t.tgname, pg_get_triggerdef(t.oid, true))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal

  union all
  select 'view', c.relname || '|' || pg_get_viewdef(c.oid, true)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v','m')

  union all
  select 'enum',
         t.typname || '|' ||
         row_number() over (partition by t.oid order by e.enumsortorder) || '|' ||
         e.enumlabel
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public'

  union all
  select 'table_security',
         format('%s|%s|%s', c.relname, c.relrowsecurity, c.relforcerowsecurity)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')

  union all
  select 'table_acl',
         c.relname || '|' ||
         string_agg(
           format('%s:%s:%s',
             coalesce(grantee.rolname, 'PUBLIC'),
             acl.privilege_type,
             acl.is_grantable),
           ',' order by coalesce(grantee.rolname, 'PUBLIC'),
                        acl.privilege_type, acl.is_grantable)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(
    coalesce(
      c.relacl,
      acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner)
    )
  ) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
  group by c.oid, c.relname

  union all
  select 'routine_acl',
         format('%s|%s|%s|%s',
           p.oid::regprocedure::text,
           coalesce(grantee.rolname, 'PUBLIC'),
           acl.privilege_type,
           acl.is_grantable)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname = 'public'
)
select kind, count(*) as objects,
       md5(string_agg(signature, E'\n' order by signature)) as definition_hash
from signatures
group by kind
order by kind;
