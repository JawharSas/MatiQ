-- =============================================================================
-- Minimal pgTAP-compatible shim, shared by scripts/test-db-local.sh (Supabase)
-- and scripts/test-db-neon.sh (Neon).
-- =============================================================================
-- Implements the subset used by supabase/tests/database/*.test.sql. Failures
-- raise immediately, so a failing assertion aborts the run with its message.
create schema tap;
grant usage on schema tap to public;

create table tap.state (planned integer, ran integer not null default 0);
grant all on tap.state to public;

create function public.plan(n integer) returns text language plpgsql as $$
begin
  delete from tap.state;
  insert into tap.state (planned) values (n);
  return '1..' || n;
end;
$$;

create function tap.record(passed boolean, description text) returns text language plpgsql as $$
declare
  n integer;
begin
  update tap.state set ran = ran + 1 returning ran into n;
  if not coalesce(passed, false) then
    raise exception 'not ok % - %', n, description;
  end if;
  return 'ok ' || n || ' - ' || description;
end;
$$;

create function public.ok(passed boolean, description text default '') returns text
language sql as $$ select tap.record(passed, description); $$;

create function public.is(have anyelement, want anyelement, description text default '') returns text
language plpgsql as $$
begin
  if have is distinct from want then
    raise exception 'not ok - % (have: %, want: %)', description, have, want;
  end if;
  return tap.record(true, description);
end;
$$;

create function public.throws_ok(query text, errcode text, errmsg text, description text) returns text
language plpgsql as $$
begin
  execute query;
  raise exception 'not ok - % (expected error %, query succeeded)', description, errcode;
exception
  when others then
    if sqlerrm like 'not ok - %' then
      raise;
    end if;
    if (errcode is not null and sqlstate <> errcode) or (errmsg is not null and sqlerrm <> errmsg) then
      raise exception 'not ok - % (have error % "%", want % "%")', description, sqlstate, sqlerrm, errcode, coalesce(errmsg, '*');
    end if;
    return tap.record(true, description);
end;
$$;

create function public.lives_ok(query text, description text) returns text
language plpgsql as $$
begin
  execute query;
  return tap.record(true, description);
exception
  when others then
    raise exception 'not ok - % (unexpected error % "%")', description, sqlstate, sqlerrm;
end;
$$;

create function public.finish() returns setof text language plpgsql as $$
declare
  s tap.state;
begin
  select * into s from tap.state;
  if s.planned is distinct from s.ran then
    raise exception 'planned % tests but ran %', s.planned, s.ran;
  end if;
  return next 'all ' || s.ran || ' tests passed';
end;
$$;

grant execute on function public.plan(integer), public.ok(boolean, text), public.is(anyelement, anyelement, text),
  public.throws_ok(text, text, text, text), public.lives_ok(text, text), public.finish(), tap.record(boolean, text)
to public;
