-- Ответы гостей для свадебного приглашения.
-- Выполните целиком в Supabase → SQL Editor → New query → Run.
-- ПЕРЕД запуском замените ПРИДУМАЙТЕ_ПАРОЛЬ в самом конце на свой пароль для admin.html.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rsvp (
  id         bigint generated always as identity primary key,
  name       text not null,
  name_key   text not null unique,
  attend     boolean not null,
  drinks     text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Без политик: напрямую таблицу никто не читает и не пишет, только через функции ниже.
alter table public.rsvp enable row level security;

create table if not exists public.admin_secret (
  id   int primary key default 1 check (id = 1),
  hash text not null
);
alter table public.admin_secret enable row level security;

-- Анкета: одна строка на гостя, повторный ответ с тем же именем обновляет строку.
create or replace function public.submit_rsvp(name text, attend text, drinks text default '')
returns json
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  n text := left(trim(coalesce(name, '')), 120);
  k text;
begin
  if n = '' then raise exception 'name required'; end if;
  k := lower(regexp_replace(replace(n, 'ё', 'е'), '\s+', ' ', 'g'));
  insert into public.rsvp (name, name_key, attend, drinks)
  values (n, k, coalesce(attend, 'yes') <> 'no', left(coalesce(drinks, ''), 200))
  on conflict (name_key) do update
    set name = excluded.name, attend = excluded.attend,
        drinks = excluded.drinks, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- Админка: список ответов по паролю.
create or replace function public.admin_rsvps(pass text)
returns setof public.rsvp
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.admin_secret s where s.hash = crypt(pass, s.hash)) then
    perform pg_sleep(1);
    raise exception 'wrong password';
  end if;
  return query select * from public.rsvp order by updated_at desc;
end $$;

-- Админка: удалить ответ (например, тестовый).
create or replace function public.admin_delete(pass text, rid bigint)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.admin_secret s where s.hash = crypt(pass, s.hash)) then
    perform pg_sleep(1);
    raise exception 'wrong password';
  end if;
  delete from public.rsvp where id = rid;
  return json_build_object('ok', true);
end $$;

grant execute on function public.submit_rsvp(text, text, text) to anon;
grant execute on function public.admin_rsvps(text) to anon;
grant execute on function public.admin_delete(text, bigint) to anon;

-- Пароль для admin.html (хранится только в виде хеша):
insert into public.admin_secret (id, hash)
values (1, extensions.crypt('ПРИДУМАЙТЕ_ПАРОЛЬ', extensions.gen_salt('bf')))
on conflict (id) do update set hash = excluded.hash;
