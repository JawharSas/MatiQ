-- =============================================================================
-- Own AI keys for any provider: stored metadata and which key analyses use.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-4111-8111-111111111111', 'byok@example.test', '{"username":"byok"}');

create function pg_temp.save(p_provider text, p_model text, p_base_url text) returns void language sql as $$
  select public.svc_upsert_api_key('a1111111-1111-4111-8111-111111111111', p_provider, repeat('c', 32), repeat('i', 16), 1::smallint,
    'Ab9_', '0123456789abcdef', null, p_model, p_base_url);
$$;
grant execute on all functions in schema pg_temp to service_role;

select pg_temp.as_service();
select lives_ok($$select pg_temp.save('openai', 'gpt-5', null)$$, 'an OpenAI key is stored with its model');
select lives_ok($$select pg_temp.save('google', 'gemini-3.1-pro', null)$$, 'so is a Gemini key');
select is((select provider from public.svc_get_active_api_key('a1111111-1111-4111-8111-111111111111')), 'google', 'the key saved last is used');
select lives_ok($$select pg_temp.save('custom', 'meta-llama/Llama-4-Scout:free', 'https://llm.example.com/v1')$$, 'a custom endpoint with its https address');
select throws_ok($$select pg_temp.save('custom', 'm', null)$$, '23514', null, 'a custom endpoint needs its address');
select throws_ok($$select pg_temp.save('custom', 'm', 'http://llm.example.com/v1')$$, '23514', null, 'and only https');
select throws_ok($$select pg_temp.save('skynet', 'm', null)$$, '23514', null, 'unknown providers are refused');
select ok(public.svc_select_api_key('a1111111-1111-4111-8111-111111111111', 'openai'), 'a stored key can be chosen');
select is(
  (select string_agg(provider || ':' || active, ',' order by provider) from public.svc_list_api_keys('a1111111-1111-4111-8111-111111111111')),
  'custom:false,google:false,openai:true', 'exactly that one is in use');

select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select throws_ok($$select * from public.svc_get_active_api_key('a1111111-1111-4111-8111-111111111111')$$, '42501', null,
  'people cannot read key rows themselves');

select * from finish();
rollback;
