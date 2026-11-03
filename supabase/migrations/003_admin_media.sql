-- Game for Lawyer: 003_admin_media.sql
-- Admin panel üçün: sual medias (şəkil, səs, video), redaktor iş axını, CSV idxalı, rol idarəsi.

-- =========================================================
-- 1. Media və yoxlama sahələri
-- =========================================================
alter table public.questions
  add column media_type text check (media_type in ('image', 'audio', 'video')),
  add column media_path text,
  add column media_alt text,
  add column self_reviewed boolean not null default false,
  add constraint media_pair check ((media_type is null) = (media_path is null));

-- Dərc üçün: qanun istinadı + rəyçi. Müəllif özü rəyçi ola bilməz, yalnız admin "özüm yoxlayıram" seçsə (self_reviewed).
alter table public.questions drop constraint published_needs_review;
alter table public.questions add constraint published_needs_review check (
  status <> 'published'
  or (legal_ref is not null and reviewed_by is not null
      and (reviewed_by is distinct from created_by or self_reviewed))
);

-- =========================================================
-- 2. Storage: question-media (oxuma açıq, yazma yalnız heyət)
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-media', 'question-media', true, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm',
        'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy media_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'question-media' and public.is_staff());
create policy media_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'question-media' and public.is_staff());
create policy media_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'question-media' and public.is_staff())
  with check (bucket_id = 'question-media' and public.is_staff());
create policy media_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'question-media' and public.is_staff());

-- =========================================================
-- 3. Oyunçuya media da göndərilir
-- =========================================================
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
      'media', case when q.media_type is null then null
                    else jsonb_build_object('type', q.media_type, 'path', q.media_path, 'alt', q.media_alt) end,
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

-- =========================================================
-- 4. Admin funksiyaları (hamısı özü icazəni yoxlayır)
-- =========================================================
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Sualı bir əməliyyatda yaradır/yeniləyir (sual + 4 variant + düzgün cavab).
-- Dərc olunmuş sual redaktə edilərsə yenidən yoxlamaya (in_review) qayıdır.
create function public.save_question(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_level   smallint := (p->>'level')::smallint;
  v_cat     smallint := (p->>'category_id')::smallint;
  v_body    text := btrim(coalesce(p->>'body', ''));
  v_opts    jsonb := p->'options';
  v_correct smallint := (p->>'correct_pos')::smallint;
  v_mtype   text := nullif(p->>'media_type', '');
  v_mpath   text := nullif(p->>'media_path', '');
  v_malt    text := nullif(btrim(coalesce(p->>'media_alt', '')), '');
  v_ref     text := nullif(btrim(coalesce(p->>'legal_ref', '')), '');
  i         int;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  if v_body = '' then raise exception 'body_required'; end if;
  if v_level is null or v_level not between 1 and 12 then raise exception 'bad_level'; end if;
  if v_cat is null then raise exception 'category_required'; end if;
  if v_opts is null or jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) <> 4 then
    raise exception 'four_options_required';
  end if;
  for i in 0..3 loop
    if btrim(coalesce(v_opts->>i, '')) = '' then raise exception 'option_empty'; end if;
  end loop;
  if v_correct is null or v_correct not between 1 and 4 then raise exception 'bad_correct'; end if;

  if v_id is null then
    insert into public.questions (category_id, level, body, status, legal_ref, created_by,
                                  media_type, media_path, media_alt)
    values (v_cat, v_level, v_body, 'draft', v_ref, auth.uid(), v_mtype, v_mpath, v_malt)
    returning id into v_id;
  else
    perform 1 from public.questions where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    update public.questions set
      category_id = v_cat, level = v_level, body = v_body, legal_ref = v_ref,
      media_type = v_mtype, media_path = v_mpath, media_alt = v_malt,
      status = case when status = 'published' then 'in_review' else status end,
      reviewed_by = case when status = 'published' then null else reviewed_by end,
      self_reviewed = case when status = 'published' then false else self_reviewed end,
      updated_at = now()
    where id = v_id;
  end if;

  delete from public.question_options where question_id = v_id;
  for i in 0..3 loop
    insert into public.question_options (question_id, pos, body) values (v_id, i + 1, btrim(v_opts->>i));
  end loop;

  insert into public.question_keys (question_id, correct_pos, explanation)
  values (v_id, v_correct, nullif(btrim(coalesce(p->>'explanation', '')), ''))
  on conflict (question_id) do update
    set correct_pos = excluded.correct_pos, explanation = excluded.explanation;

  return v_id;
end $$;

-- Status keçidləri: draft → in_review → published; arxivə və geri
create function public.set_question_status(p_id uuid, p_status text, p_self_review boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q     public.questions%rowtype;
  v_new public.question_status := p_status::public.question_status;
  v_uid uuid := auth.uid();
  v_self boolean;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  select * into q from public.questions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  if (q.status::text, v_new::text) not in (
       ('draft', 'in_review'), ('in_review', 'draft'), ('in_review', 'published'),
       ('published', 'archived'), ('draft', 'archived'), ('in_review', 'archived'), ('archived', 'draft')) then
    raise exception 'bad_transition';
  end if;

  if v_new = 'published' then
    if q.legal_ref is null then raise exception 'legal_ref_required'; end if;
    v_self := coalesce(q.created_by = v_uid, false);
    if v_self and not (p_self_review and public.is_admin()) then
      raise exception 'author_cannot_review';
    end if;
    update public.questions
       set status = 'published', reviewed_by = v_uid, self_reviewed = v_self,
           last_verified_at = current_date, updated_at = now()
     where id = p_id;
  else
    update public.questions
       set status = v_new,
           reviewed_by = case when v_new in ('draft', 'in_review') then null else reviewed_by end,
           self_reviewed = case when v_new in ('draft', 'in_review') then false else self_reviewed end,
           updated_at = now()
     where id = p_id;
  end if;
end $$;

-- Yalnız qaralama silinə bilər (oyunlarda istifadə olunmuş sual arxivlənir)
create function public.delete_question(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status public.question_status;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  select status into v_status from public.questions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_status <> 'draft' then raise exception 'only_drafts_can_be_deleted'; end if;
  begin
    delete from public.questions where id = p_id;
  exception when foreign_key_violation then
    raise exception 'question_in_use';
  end;
end $$;

-- CSV idxalı: hər sətir qaralama kimi yaradılır, səhvli sətirlər ayrıca qaytarılır
create function public.import_questions(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        jsonb;
  i        int := 0;
  v_ok     int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_cat    smallint;
  v_key    text;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_required';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_key := lower(btrim(coalesce(r->>'category', '')));
      v_cat := null;
      select id into v_cat from public.categories
       where slug = v_key or lower(title_az) = v_key limit 1;
      if v_cat is null then
        raise exception 'unknown_category: %', v_key;
      end if;
      perform public.save_question(jsonb_build_object(
        'category_id', v_cat,
        'level', r->>'level',
        'body', r->>'body',
        'options', jsonb_build_array(r->>'opt1', r->>'opt2', r->>'opt3', r->>'opt4'),
        'correct_pos', r->>'correct',
        'explanation', r->>'explanation',
        'legal_ref', r->>'legal_ref'));
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', i, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('inserted', v_ok, 'errors', v_errors);
end $$;

create function public.list_users()
returns table (id uuid, username text, role text, best_score int, games_played int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query
    select p.id, p.username, p.role, p.best_score, p.games_played, p.created_at
      from public.profiles p order by p.created_at desc limit 500;
end $$;

create function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_role not in ('player', 'editor', 'admin') then
    raise exception 'bad_role';
  end if;
  if p_user = auth.uid() and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'last_admin';
  end if;
  update public.profiles set role = p_role where id = p_user;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Pillə × status üzrə sual sayı (örtük cədvəli)
create function public.question_coverage()
returns table (level smallint, status public.question_status, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  return query
    select q.level, q.status, count(*) from public.questions q group by q.level, q.status;
end $$;

revoke execute on function
  public.is_admin(), public.save_question(jsonb), public.set_question_status(uuid, text, boolean),
  public.delete_question(uuid), public.import_questions(jsonb), public.list_users(),
  public.set_user_role(uuid, text), public.question_coverage()
from public, anon;
grant execute on function
  public.is_admin(), public.save_question(jsonb), public.set_question_status(uuid, text, boolean),
  public.delete_question(uuid), public.import_questions(jsonb), public.list_users(),
  public.set_user_role(uuid, text), public.question_coverage()
to authenticated;
