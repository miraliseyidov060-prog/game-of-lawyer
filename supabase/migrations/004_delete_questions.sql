-- Siyahıdan istənilən sualı silmək üçün.
-- Əvvəl yalnız qaralama silinirdi. İndi: heç bir oyunda istifadə olunmayıbsa status fərq etmədən silinir;
-- oyunlarda artıq iştirak edibsə (run_questions) bazadan çıxarmaq mümkün deyil, sual arxivə göndərilir
-- (oyundan çıxır, keçmiş nəticələr pozulmur).
-- Qaytarır: 'deleted' | 'archived' | 'in_use' (artıq arxivdədir və tarixçəsi var).

drop function if exists public.delete_question(uuid);

create function public.delete_question(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_status public.question_status;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  select status into v_status from public.questions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  begin
    delete from public.questions where id = p_id;
    return 'deleted';
  exception when foreign_key_violation then
    if v_status = 'archived' then
      return 'in_use';
    end if;
    update public.questions set status = 'archived', updated_at = now() where id = p_id;
    return 'archived';
  end;
end $$;

revoke execute on function public.delete_question(uuid) from public, anon;
grant execute on function public.delete_question(uuid) to authenticated;
