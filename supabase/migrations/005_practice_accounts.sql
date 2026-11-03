-- 005: məşq rejimi (reytinqə təsir etmir), istifadəçi adı qaydaları, hesabı silmə.
-- Heç bir mövcud funksiya silinmir: start_run(text) olduğu kimi qalır, məşq üçün ayrıca start_practice yazılıb.

-- =========================================================
-- 1. MƏŞQ REJİMİ
-- =========================================================
-- practice_category_id dolu olan oyun "məşq"dir: reytinqə, ən yaxşı xala və oyun sayına yazılmır.
alter table public.game_runs
  add column if not exists practice_category_id smallint references public.categories (id) on delete cascade;

-- Kateqoriyalar və hər birində dərc olunmuş sual sayı (məşq üçün ən azı 12 sual lazımdır)
create or replace function public.practice_categories()
returns table (id smallint, title_az text, question_count int, playable boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.title_az, count(q.id)::int, count(q.id) >= 12
    from public.categories c
    left join public.questions q on q.category_id = c.id and q.status = 'published'
   where c.is_active
   group by c.id, c.title_az, c.sort_order
   order by c.sort_order, c.id;
$$;

-- Seçilmiş bir kateqoriyadan 12 sual. Hər mövqe üçün çətinliyi ona ən yaxın (təkrarlanmayan) sual seçilir,
-- sonra seçilmişlər çətinliyə görə düzülür: sual nömrəsi artdıqca çətinlik azalmır.
create or replace function public.start_practice(p_category smallint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
  v_q   uuid;
  v_ids uuid[] := '{}';
  l     int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.categories where id = p_category and is_active) then
    raise exception 'bad_category';
  end if;
  if (select count(*) from public.questions where status = 'published' and category_id = p_category) < 12 then
    raise exception 'not enough published questions';
  end if;

  update public.game_runs
     set status = 'abandoned', finished_at = now()
   where user_id = v_uid and status = 'active';

  insert into public.game_runs (user_id, mode, practice_category_id)
  values (v_uid, 'solo', p_category)
  returning id into v_run;

  for l in 1..12 loop
    select qq.id into v_q
      from public.questions qq
     where qq.status = 'published' and qq.category_id = p_category and qq.id <> all (v_ids)
     order by abs(qq.level - l), random()
     limit 1;
    v_ids := v_ids || v_q;
  end loop;

  insert into public.run_questions (run_id, level, question_id)
  select v_run, (row_number() over (order by qq.level, random()))::smallint, qq.id
    from public.questions qq
   where qq.id = any (v_ids);

  update public.run_questions set served_at = now() where run_id = v_run and level = 1;

  return public.get_run_state(v_run) || jsonb_build_object('practice', true);
end $$;

-- submit_answer: yalnız şərt dəyişir (məşq oyunu reytinqə yazılmır). Qalanı 002-dəki ilə eynidir.
create or replace function public.submit_answer(p_run uuid, p_choice smallint) returns jsonb
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
  if rq.served_at is null then
    raise exception 'question not revealed';
  end if;
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

  -- qonaq (anonim) istifadəçilər və məşq oyunları reytinqə düşmür
  if v_final and r.practice_category_id is null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
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
    'banked', r.banked,
    'finished', v_final,
    'status', r.status,
    'level', r.current_level,
    'next', case when v_final then null else public.get_run_state(r.id) end
  );
end $$;

-- Sual statistikası yalnız reytinq oyunlarından hesablanır (məşqdə eyni 12 sual təkrarlana bilər)
create or replace view public.question_stats with (security_invoker = true) as
select rq.question_id, count(*) as answered, round(avg(rq.is_correct::int), 3) as correct_rate
from public.run_questions rq
join public.game_runs gr on gr.id = rq.run_id
where rq.is_correct is not null and gr.practice_category_id is null
group by rq.question_id;

-- =========================================================
-- 2. İSTİFADƏÇİ ADI QAYDALARI
-- =========================================================
-- Ad: 3–20 simvol, a–z 0–9 _ ; qorunan sözlər və "oyuncu_" (avtomatik adlar) götürülə bilməz.
create or replace function public.username_valid(p_name text) returns boolean
language sql immutable set search_path = public as $$
  select p_name ~ '^[a-z0-9_]{3,20}$'
     and p_name not like 'oyuncu\_%' escape '\'
     and p_name <> all (array['admin', 'root', 'system', 'system_seed', 'support', 'moderator', 'editor', 'kalkhan']);
$$;

-- Qeydiyyatda metadata-dakı ad yararlı və boşdursa onu götürür, əks halda avtomatik ad verir
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_auto text := 'oyuncu_' || substr(md5(new.id::text), 1, 12);
begin
  if not public.username_valid(v_name) or exists (select 1 from public.profiles where username = v_name) then
    v_name := v_auto;
  end if;
  begin
    insert into public.profiles (id, username) values (new.id, v_name);
  exception when unique_violation then
    insert into public.profiles (id, username) values (new.id, v_auto);
  end;
  return new;
end $$;

-- Qeydiyyat formunda canlı yoxlama (giriş etməmiş istifadəçi də çağıra bilər)
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.username_valid(lower(btrim(coalesce(p_name, ''))))
     and not exists (select 1 from public.profiles where username = lower(btrim(p_name)));
$$;

-- Adı yalnız bu funksiya dəyişir (birbaşa UPDATE icazəsi götürülür)
create or replace function public.set_username(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v text := lower(btrim(coalesce(p_name, '')));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.username_valid(v) then
    raise exception 'bad_username';
  end if;
  begin
    update public.profiles set username = v where id = auth.uid();
  exception when unique_violation then
    raise exception 'username_taken';
  end;
end $$;

revoke update (username) on public.profiles from authenticated;

-- =========================================================
-- 3. HESABI SİLMƏ
-- =========================================================
-- Oyunçu öz hesabını və bütün oyun tarixçəsini silir. Redaktor/admin özünü silə bilməz
-- (yaratdığı suallar ona bağlıdır): əvvəlcə rolu aşağı salınmalıdır.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role in ('editor', 'admin') then
    raise exception 'staff_cannot_self_delete';
  end if;
  delete from auth.users where id = v_uid;
end $$;

-- =========================================================
-- 4. İCAZƏLƏR
-- =========================================================
revoke execute on function
  public.practice_categories(), public.start_practice(smallint), public.username_valid(text),
  public.username_available(text), public.set_username(text), public.delete_my_account()
from public, anon;
grant execute on function
  public.practice_categories(), public.start_practice(smallint), public.set_username(text),
  public.delete_my_account()
to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
