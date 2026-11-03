-- =========================================================
-- 4. PROTOTİP ÜÇÜN TEST MƏZMUNU (real sual deyil!)
-- Əvvəl Authentication > Add user ilə bir istifadəçi yaradın.
-- =========================================================
insert into public.categories (slug, title_az, sort_order) values
  ('konstitusiya', 'Konstitusiya hüququ', 1),
  ('mulki', 'Mülki hüquq', 2),
  ('cinayet', 'Cinayət hüququ', 3);

do $$
declare
  v_rev uuid := (select id from public.profiles order by created_at limit 1);
  v_q   uuid;
  lvl   int;
  n     int;
begin
  for lvl in 1..12 loop
    for n in 1..3 loop
      insert into public.questions (category_id, level, body, status, legal_ref, reviewed_by, last_verified_at)
      values ((select id from public.categories order by random() limit 1), lvl,
              format('TEST sualı: pillə %s, nömrə %s', lvl, n), 'published', 'TEST', v_rev, current_date)
      returning id into v_q;

      insert into public.question_options (question_id, pos, body)
      select v_q, p, format('Variant %s', p) from generate_series(1, 4) as p;

      insert into public.question_keys (question_id, correct_pos, explanation)
      values (v_q, 1 + (n % 4), 'TEST izahı');
    end loop;
  end loop;
end $$;

-- İlk admini özünüz təyin edin (SQL Editor yüksək səlahiyyətlə işləyir):
-- update public.profiles set role = 'admin' where id = '<sizin-user-id>';
