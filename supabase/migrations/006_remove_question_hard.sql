-- remove_question artıq heç vaxt "arxivə göndərmir": sual oyunçuların oyun tarixçəsində istifadə olunubsa belə silinir.
-- Silinəndə:
--   * sualın cavab yazıları (run_questions) də silinir; oyunların özü, xallar, reytinq və best_score dəyişmir;
--   * sualın olduğu AKTİV oyunlar dayandırılır (oyunçu silinmiş sualla qalmasın).
-- Qaytarır həmişə 'deleted'.

create or replace function public.remove_question(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  perform 1 from public.questions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  update public.game_runs
     set status = 'abandoned', finished_at = now()
   where status = 'active'
     and id in (select run_id from public.run_questions where question_id = p_id);

  delete from public.run_questions where question_id = p_id;
  delete from public.questions where id = p_id;
  return 'deleted';
end $$;
