-- =============================================================================
-- Any AI provider for people's own keys.
--
--   * user_api_keys accepts every provider the functions support (Claude,
--     OpenAI, Google Gemini, xAI, OpenRouter, Groq, Mistral, Together, and a
--     custom OpenAI-compatible endpoint) and remembers the chosen model and,
--     for a custom endpoint, its https address.
--   * One key at a time is used for analyses: the one saved or chosen last
--     (selected_at). The others stay stored until removed.
-- =============================================================================

alter table private.user_api_keys drop constraint api_key_provider;
alter table private.user_api_keys add constraint api_key_provider
  check (provider in ('anthropic', 'openai', 'google', 'xai', 'openrouter', 'groq', 'mistral', 'together', 'custom'));

-- Keys from other providers may end in other printable characters.
alter table private.user_api_keys drop constraint api_key_last4;
alter table private.user_api_keys add constraint api_key_last4 check (last4 ~ '^[!-~]{4}$');

alter table private.user_api_keys
  add column model text
    constraint api_key_model check (model is null or model ~ '^[A-Za-z0-9._:/@+-]{1,200}$'),
  add column base_url text
    constraint api_key_base_url check (base_url is null or (base_url ~ '^https://[^/?#@\s]+(/[^?#\s]*)?$' and char_length(base_url) <= 300)),
  add column selected_at timestamptz not null default now(),
  add constraint api_key_custom_url check ((provider = 'custom') = (base_url is not null));

-- Saving a key also makes it the one analyses use.
drop function public.svc_upsert_api_key(uuid, text, text, text, smallint, text, text, text);
create function public.svc_upsert_api_key(
  p_user_id uuid,
  p_provider text,
  p_ciphertext text,
  p_iv text,
  p_key_version smallint,
  p_last4 text,
  p_fingerprint text,
  p_label text,
  p_model text,
  p_base_url text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.user_api_keys (user_id, provider, ciphertext, iv, key_version, last4, fingerprint, label, model, base_url, selected_at)
  values (p_user_id, p_provider, p_ciphertext, p_iv, p_key_version, p_last4, p_fingerprint, p_label, p_model, p_base_url, clock_timestamp())
  on conflict (user_id, provider) do update
  set ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      key_version = excluded.key_version,
      last4 = excluded.last4,
      fingerprint = excluded.fingerprint,
      label = excluded.label,
      model = excluded.model,
      base_url = excluded.base_url,
      created_at = now(),
      selected_at = clock_timestamp(),
      last_used_at = null;
$$;

-- The key analyses use: the one saved or chosen last.
create function public.svc_get_active_api_key(p_user_id uuid)
returns table (id uuid, provider text, ciphertext text, iv text, key_version smallint, model text, base_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.provider, k.ciphertext, k.iv, k.key_version, k.model, k.base_url
  from private.user_api_keys k
  where k.user_id = p_user_id
  order by k.selected_at desc
  limit 1;
$$;

create function public.svc_select_api_key(p_user_id uuid, p_provider text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- clock_timestamp: two choices in one transaction still have an order.
  update private.user_api_keys set selected_at = clock_timestamp() where user_id = p_user_id and provider = p_provider;
  return found;
end;
$$;

drop function public.svc_list_api_keys(uuid);
create function public.svc_list_api_keys(p_user_id uuid)
returns table (
  provider text,
  last4 text,
  label text,
  model text,
  base_url text,
  active boolean,
  created_at timestamptz,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.provider, k.last4, k.label, k.model, k.base_url,
    k.selected_at = max(k.selected_at) over (),
    k.created_at, k.last_used_at
  from private.user_api_keys k
  where k.user_id = p_user_id
  order by k.selected_at desc;
$$;

revoke execute on function
  public.svc_upsert_api_key(uuid, text, text, text, smallint, text, text, text, text, text),
  public.svc_get_active_api_key(uuid),
  public.svc_select_api_key(uuid, text),
  public.svc_list_api_keys(uuid)
from public, anon, authenticated;

grant execute on function
  public.svc_upsert_api_key(uuid, text, text, text, smallint, text, text, text, text, text),
  public.svc_get_active_api_key(uuid),
  public.svc_select_api_key(uuid, text),
  public.svc_list_api_keys(uuid)
to service_role;
