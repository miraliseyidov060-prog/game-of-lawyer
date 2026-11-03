-- Game for Lawyer: 001_init.sql (Supabase / PostgreSQL 15+)
-- Tətbiq olunub: layihə gkfsppkpetziinyyxduj (eu-central-1), 2026-11-03

-- =========================================================
-- 1. CƏDVƏLLƏR
-- =========================================================
create type public.question_status as enum ('draft', 'in_review', 'published', 'archived');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (char_length(username) between 3 and 20),
  role         text not null default 'player' check (role in ('player', 'editor', 'admin')),
  best_score   int  not null default 0,
  games_played int  not null default 0,
  created_at   timestamptz not null default now()
);

create table public.categories (
  id         smallint generated always as identity primary key,
  slug       text not null unique,
  title_az   text not null,
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  category_id      smallint not null references public.categories (id),
  level            smallint not null check (level between 1 and 12),
  body             text not null,
  status           public.question_status not null default 'draft',
  legal_ref        text,
  last_verified_at date,
  created_by       uuid references public.profiles (id),
  reviewed_by      uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- dərc üçün: qanun istinadı + müəllifdən fərqli rəyçi
  constraint published_needs_review check (
    status <> 'published'
    or (legal_ref is not null and reviewed_by is not null and reviewed_by is distinct from created_by)
  )
);
create index questions_pick_idx on public.questions (status, level, category_id);

create table public.question_options (
  question_id uuid not null references public.questions (id) on delete cascade,
  pos         smallint not null check (pos between 1 and 4),
  body        text not null,
  primary key (question_id, pos)
);

-- Düzgün cavab: müştəri oxuya bilmir (RLS aktivdir, oxuma siyasəti yalnız heyət üçündür)
create table public.question_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_pos smallint not null check (correct_pos between 1 and 4),
  explanation text
);

create table public.game_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  mode           text not null default 'solo' check (mode in ('solo', 'daily', 'duel')),
  status         text not null default 'active' check (status in ('active', 'finished', 'failed', 'abandoned')),
  current_level  smallint not null default 1,
  score          int not null default 0,
  banked         int not null default 0,
  lifelines_used text[] not null default '{}',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index game_runs_user_idx on public.game_runs (user_id, started_at desc);

create table public.run_questions (
  run_id      uuid not null references public.game_runs (id) on delete cascade,
  level       smallint not null,
  question_id uuid not null references public.questions (id),
  served_at   timestamptz not null default now(),
  chosen      smallint,
  is_correct  boolean,
  ms_taken    int,
  primary key (run_id, level)
);

create table public.leaderboard_weekly (
  week_start date not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  score      int not null,
  primary key (week_start, user_id)
);
create index leaderboard_weekly_rank_idx on public.leaderboard_weekly (week_start, score desc);

-- Onlayn rejim üçün baseline (siyasət yoxdur = müştəri üçün bağlıdır)
create table public.matches (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'waiting' check (status in ('waiting', 'live', 'finished')),
  created_at timestamptz not null default now()
);
create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  score    int not null default 0,
  primary key (match_id, user_id)
);

-- Sualların çətinlik kalibrləməsi üçün
create view public.question_stats with (security_invoker = true) as
select question_id, count(*) as answered, round(avg(is_correct::int), 3) as correct_rate
from public.run_questions
where is_correct is not null
group by question_id;

-- =========================================================
-- 2. TƏHLÜKƏSİZLİK (RLS)
-- =========================================================
alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.questions          enable row level security;
alter table public.question_options   enable row level security;
alter table public.question_keys      enable row level security;
alter table public.game_runs          enable row level security;
alter table public.run_questions      enable row level security;
alter table public.leaderboard_weekly enable row level security;
alter table public.matches            enable row level security;
alter table public.match_players      enable row level security;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('editor', 'admin')
  );
$$;

create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- profil: hamı oxuya bilər (role sütunu xaric), yalnız öz username-ini dəyişə bilər
create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke select, update on public.profiles from anon, authenticated;
grant select (id, username, best_score, games_played, created_at) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;

-- kataloq və suallar: oxuma/yazma yalnız heyət (oyunçular RPC ilə alır)
create policy categories_read  on public.categories for select using (is_active);
create policy categories_staff on public.categories for all
  using (public.is_staff()) with check (public.is_staff());
create policy questions_staff  on public.questions for all
  using (public.is_staff()) with check (public.is_staff());
create policy options_staff    on public.question_options for all
  using (public.is_staff()) with check (public.is_staff());
create policy keys_staff       on public.question_keys for all
  using (public.is_staff()) with check (public.is_staff());

-- oyunlar: oyunçu yalnız öz oyunlarını oxuyur, yazmanı yalnız funksiyalar edir
create policy runs_read_own    on public.game_runs for select
  using (user_id = auth.uid() or public.is_staff());
create policy run_q_staff_read on public.run_questions for select using (public.is_staff());
create policy lb_read          on public.leaderboard_weekly for select using (true);

-- =========================================================
-- 3. SERVER MƏNTİQİ
-- =========================================================
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'oyuncu_' || substr(md5(new.id::text), 1, 12));
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Cari sualı (düzgün cavabsız) qaytarır
create function public.get_run_state(p_run uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'run_id', r.id,
    'status', r.status,
    'level', r.current_level,
    'score', r.score,
    'lifelines_used', r.lifelines_used,
    'question', jsonb_build_object(
      'id', q.id,
      'body', q.body,
      'options', (
        select jsonb_agg(jsonb_build_object('pos', o.pos, 'body', o.body) order by o.pos)
        from public.question_options o
        where o.question_id = q.id
      )
    )
  )
  from public.game_runs r
  join public.run_questions rq on rq.run_id = r.id and rq.level = r.current_level
  join public.questions q on q.id = rq.question_id
  where r.id = p_run and r.user_id = auth.uid();
$$;

-- Yeni oyun: hər pillə üçün bir dərc olunmuş sual seçir
create function public.start_run(p_mode text default 'solo') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.game_runs
     set status = 'abandoned', finished_at = now()
   where user_id = v_uid and status = 'active';

  insert into public.game_runs (user_id, mode) values (v_uid, p_mode)
  returning id into v_run;

  insert into public.run_questions (run_id, level, question_id)
  select v_run, l.level, q.id
  from generate_series(1, 12) as l(level)
  cross join lateral (
    select id from public.questions
    where status = 'published' and questions.level = l.level
    order by random()
    limit 1
  ) q;

  if (select count(*) from public.run_questions where run_id = v_run) < 12 then
    raise exception 'not enough published questions';
  end if;

  return public.get_run_state(v_run);
end $$;

-- Cavab: yoxlama, xal və vaxt yalnız serverdə
create function public.submit_answer(p_run uuid, p_choice smallint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r       public.game_runs%rowtype;
  rq      public.run_questions%rowtype;
  k       public.question_keys%rowtype;
  v_ms    int;
  v_ok    boolean;
  v_final boolean := false;
  v_base  int;
  v_gain  int := 0;
begin
  select * into r from public.game_runs
   where id = p_run and user_id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'run is not active';
  end if;

  select * into rq from public.run_questions
   where run_id = r.id and level = r.current_level;
  select * into k from public.question_keys where question_id = rq.question_id;

  -- vaxtı server ölçür; limit 30 san + 2 san şəbəkə payı
  v_ms := least(60000, (extract(epoch from (now() - rq.served_at)) * 1000)::int);
  v_ok := coalesce(p_choice = k.correct_pos, false) and v_ms <= 32000;

  update public.run_questions
     set chosen = p_choice, is_correct = v_ok, ms_taken = v_ms
   where run_id = r.id and level = r.current_level;

  if v_ok then
    v_base := r.current_level * 100;
    v_gain := v_base + floor(v_base * greatest(0, 1 - v_ms / 30000.0) / 2)::int;
    r.score := r.score + v_gain;
    if r.current_level in (4, 8) then
      r.banked := r.score;
    end if;
    if r.current_level = 12 then
      r.status := 'finished';
      v_final := true;
    else
      r.current_level := r.current_level + 1;
      update public.run_questions set served_at = now()
       where run_id = r.id and level = r.current_level;
    end if;
  else
    r.score := r.banked;
    r.status := 'failed';
    v_final := true;
  end if;

  if v_final then
    r.finished_at := now();
  end if;

  update public.game_runs
     set current_level = r.current_level, score = r.score, banked = r.banked,
         status = r.status, finished_at = r.finished_at
   where id = r.id;

  -- qonaq (anonim) istifadəçilər reytinqə düşmür
  if v_final and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    update public.profiles
       set best_score = greatest(best_score, r.score), games_played = games_played + 1
     where id = r.user_id;

    insert into public.leaderboard_weekly (week_start, user_id, score)
    values (date_trunc('week', now())::date, r.user_id, r.score)
    on conflict (week_start, user_id)
    do update set score = greatest(public.leaderboard_weekly.score, excluded.score);
  end if;

  return jsonb_build_object(
    'correct', v_ok,
    'correct_pos', k.correct_pos,
    'explanation', k.explanation,
    'gain', v_gain,
    'score', r.score,
    'finished', v_final,
    'status', r.status,
    'next', case when v_final then null else public.get_run_state(r.id) end
  );
end $$;

-- "Məcəllə": iki səhv variantı silir (oyunda bir dəfə)
create function public.use_lifeline_eliminate(p_run uuid) returns smallint[]
language plpgsql security definer set search_path = public as $$
declare
  r      public.game_runs%rowtype;
  v_hide smallint[];
begin
  select * into r from public.game_runs
   where id = p_run and user_id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'run is not active';
  end if;
  if 'eliminate' = any (r.lifelines_used) then
    raise exception 'lifeline already used';
  end if;

  select array_agg(s.pos) into v_hide
  from (
    select o.pos
    from public.run_questions rq
    join public.question_options o on o.question_id = rq.question_id
    join public.question_keys k on k.question_id = rq.question_id
    where rq.run_id = r.id and rq.level = r.current_level and o.pos <> k.correct_pos
    order by random()
    limit 2
  ) s;

  update public.game_runs
     set lifelines_used = array_append(lifelines_used, 'eliminate')
   where id = r.id;
  return v_hide;
end $$;

create function public.get_leaderboard(p_period text default 'weekly', p_limit int default 50)
returns table (rank bigint, username text, score int)
language sql stable security definer set search_path = public as $$
  select rank() over (order by s.score desc) as rank, p.username, s.score
  from (
    select lw.user_id, lw.score
    from public.leaderboard_weekly lw
    where p_period = 'weekly' and lw.week_start = date_trunc('week', now())::date
    union all
    select pr.id, pr.best_score
    from public.profiles pr
    where p_period = 'alltime' and pr.best_score > 0
  ) s
  join public.profiles p on p.id = s.user_id
  order by 1
  limit least(p_limit, 100);
$$;

-- Funksiyaları yalnız giriş etmiş istifadəçilərə aç
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.start_run(text), public.get_run_state(uuid), public.submit_answer(uuid, smallint),
  public.use_lifeline_eliminate(uuid), public.get_leaderboard(text, int), public.my_role(),
  public.is_staff()
to authenticated;
