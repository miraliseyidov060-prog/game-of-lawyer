-- Game for Lawyer: 002_reveal_question.sql
-- Problem: sualın 30 saniyəlik saatı əvvəlki cavab verilən an başlayırdı, istifadəçi izahı oxuyarkən vaxt gedirdi.
-- Həll: növbəti sual yalnız reveal_question() ilə açılır və saat da o anda başlayır.
-- Cavabdan əvvəl sualı görmək mümkün deyil, saatı gecikdirmək də mümkün deyil.

alter table public.run_questions alter column served_at drop not null;
alter table public.run_questions alter column served_at drop default;

-- Sual açılmayıbsa (served_at boşdur) 'question' null qaytarılır
create or replace function public.get_run_state(p_run uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'run_id', r.id,
    'status', r.status,
    'level', r.current_level,
    'score', r.score,
    'lifelines_used', r.lifelines_used,
    'elapsed_ms', case when rq.served_at is null then null
                       else (extract(epoch from (now() - rq.served_at)) * 1000)::int end,
    'question', case when rq.served_at is null then null else jsonb_build_object(
      'id', q.id,
      'body', q.body,
      'options', (
        select jsonb_agg(jsonb_build_object('pos', o.pos, 'body', o.body) order by o.pos)
        from public.question_options o
        where o.question_id = q.id
      )
    ) end
  )
  from public.game_runs r
  join public.run_questions rq on rq.run_id = r.id and rq.level = r.current_level
  join public.questions q on q.id = rq.question_id
  where r.id = p_run and r.user_id = auth.uid();
$$;

-- Cari sualı açır və saatı başladır (təkrar çağırışda saatı sıfırlamır)
create function public.reveal_question(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.game_runs%rowtype;
begin
  select * into r from public.game_runs
   where id = p_run and user_id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'run is not active';
  end if;

  update public.run_questions set served_at = coalesce(served_at, now())
   where run_id = r.id and level = r.current_level;

  return public.get_run_state(r.id);
end $$;

revoke execute on function public.reveal_question(uuid) from public, anon;
grant execute on function public.reveal_question(uuid) to authenticated;

-- Yeni oyun: 1-ci sual dərhal açılır
create or replace function public.start_run(p_mode text default 'solo') returns jsonb
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

  update public.run_questions set served_at = now() where run_id = v_run and level = 1;

  return public.get_run_state(v_run);
end $$;

-- Cavab: növbəti sual avtomatik açılmır ('next.question' null), reveal_question() çağırılmalıdır
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
    'banked', r.banked,
    'finished', v_final,
    'status', r.status,
    'level', r.current_level,
    'next', case when v_final then null else public.get_run_state(r.id) end
  );
end $$;
