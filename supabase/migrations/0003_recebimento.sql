-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0003 RECEBIMENTO
-- Fluxo do POP: recebimento, conferência e etiquetagem, revisão,
-- atualização do sistema (entrada no estoque) e liberação para guarda.
-- A nota fiscal é anexada como arquivo; a validação é simulada.
--
-- Rode depois do 0002_materiais.sql: SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create sequence if not exists public.recebimentos_numero_seq;

create table if not exists public.recebimentos (
  id bigint generated always as identity primary key,
  numero text not null unique,
  unidade_id bigint not null references public.unidades (id),
  fornecedor text not null check (length(btrim(fornecedor)) >= 2),
  nf_numero text not null check (length(btrim(nf_numero)) >= 1),
  nf_serie text,
  nf_data date,
  nf_arquivo_path text,
  nf_arquivo_nome text,
  observacao text,
  status text not null default 'CONFERENCIA'
    check (status in ('CONFERENCIA', 'DIVERGENTE', 'APROVADO', 'GUARDADO', 'CANCELADO')),
  checklist jsonb not null default '{}',
  divergencia text,
  evidencias text[] not null default '{}',
  recebido_por_nome text,
  conferido_por uuid,
  conferido_por_nome text,
  conferido_em timestamptz,
  aprovado_por uuid,
  aprovado_por_nome text,
  aprovado_em timestamptz,
  guardado_por uuid,
  guardado_por_nome text,
  guardado_em timestamptz,
  cancelado_motivo text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
-- A mesma nota do mesmo fornecedor não entra duas vezes (menos as canceladas).
create unique index if not exists recebimentos_nf_unica on public.recebimentos
  (unidade_id, public.normalizar(fornecedor), public.normalizar(nf_numero), public.normalizar(coalesce(nf_serie, '')))
  where status <> 'CANCELADO';
create index if not exists recebimentos_status_idx on public.recebimentos (status, criado_em desc);

create table if not exists public.recebimento_itens (
  id bigint generated always as identity primary key,
  recebimento_id bigint not null references public.recebimentos (id) on delete cascade,
  material_id bigint not null references public.materiais (id),
  quantidade_nf numeric not null check (quantidade_nf > 0),
  -- Quantidade contada em boas condições. É ela que entra no estoque.
  quantidade_conferida numeric check (quantidade_conferida is null or quantidade_conferida >= 0),
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid,
  constraint recebimento_itens_material_unico unique (recebimento_id, material_id)
);
create index if not exists recebimento_itens_recebimento_idx on public.recebimento_itens (recebimento_id);

-- ---------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------

-- A situação só muda pelas funções abaixo (aprovar, divergência, guarda, cancelar).
create or replace function public.ajustar_recebimento()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_pela_funcao boolean := coalesce(current_setting('app.recebimento', true), '') = '1';
begin
  new.fornecedor := btrim(new.fornecedor);
  new.nf_numero := btrim(new.nf_numero);
  new.nf_serie := nullif(btrim(coalesce(new.nf_serie, '')), '');
  new.observacao := nullif(btrim(coalesce(new.observacao, '')), '');
  if tg_op = 'INSERT' then
    new.numero := 'REC-' || lpad(nextval('public.recebimentos_numero_seq')::text, 6, '0');
    new.status := 'CONFERENCIA';
    new.divergencia := null;
    new.evidencias := '{}';
    select nome into new.recebido_por_nome from public.perfis where id = public.ator_atual();
    new.conferido_por := null; new.conferido_por_nome := null; new.conferido_em := null;
    new.aprovado_por := null; new.aprovado_por_nome := null; new.aprovado_em := null;
    new.guardado_por := null; new.guardado_por_nome := null; new.guardado_em := null;
    new.cancelado_motivo := null;
    return new;
  end if;
  new.numero := old.numero;
  new.recebido_por_nome := old.recebido_por_nome;
  if not v_pela_funcao then
    if new.status is distinct from old.status then
      raise exception 'A situação do recebimento muda pelos botões de conferência, aprovação ou cancelamento.';
    end if;
    if old.status in ('APROVADO', 'GUARDADO', 'CANCELADO') then
      raise exception 'Recebimento % já encerrado. Ele não pode mais ser alterado.', old.numero;
    end if;
    new.divergencia := old.divergencia;
    new.evidencias := old.evidencias;
    new.conferido_por := old.conferido_por; new.conferido_por_nome := old.conferido_por_nome; new.conferido_em := old.conferido_em;
    new.aprovado_por := old.aprovado_por; new.aprovado_por_nome := old.aprovado_por_nome; new.aprovado_em := old.aprovado_em;
    new.guardado_por := old.guardado_por; new.guardado_por_nome := old.guardado_por_nome; new.guardado_em := old.guardado_em;
    new.cancelado_motivo := old.cancelado_motivo;
  end if;
  return new;
end $$;

-- Itens só mudam enquanto o recebimento está aberto.
create or replace function public.ajustar_recebimento_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_rec bigint := coalesce(new.recebimento_id, old.recebimento_id);
begin
  select status into v_status from public.recebimentos where id = v_rec;
  if v_status not in ('CONFERENCIA', 'DIVERGENTE') and coalesce(current_setting('app.recebimento', true), '') <> '1' then
    raise exception 'Este recebimento já foi encerrado. Os itens não podem mudar.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.recebimento_id := old.recebimento_id;
  end if;
  if not exists (select 1 from public.materiais where id = new.material_id and removido_em is null) then
    raise exception 'O material escolhido não existe ou foi removido.';
  end if;
  new.observacao := nullif(btrim(coalesce(new.observacao, '')), '');
  return new;
end $$;

drop trigger if exists a_carimbar on public.recebimentos;
create trigger a_carimbar before insert or update on public.recebimentos
  for each row execute function public.carimbar();
drop trigger if exists b_ajustar_recebimento on public.recebimentos;
create trigger b_ajustar_recebimento before insert or update on public.recebimentos
  for each row execute function public.ajustar_recebimento();
drop trigger if exists z_auditoria on public.recebimentos;
create trigger z_auditoria after insert or update or delete on public.recebimentos
  for each row execute function public.registrar_auditoria();

drop trigger if exists a_carimbar on public.recebimento_itens;
create trigger a_carimbar before insert or update on public.recebimento_itens
  for each row execute function public.carimbar();
drop trigger if exists b_ajustar_item on public.recebimento_itens;
create trigger b_ajustar_item before insert or update or delete on public.recebimento_itens
  for each row execute function public.ajustar_recebimento_item();

-- ---------------------------------------------------------------------
-- Permissões: todos consultam; almoxarife, gestor e master registram.
-- ---------------------------------------------------------------------

alter table public.recebimentos enable row level security;
alter table public.recebimento_itens enable row level security;

drop policy if exists consultar on public.recebimentos;
create policy consultar on public.recebimentos for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists cadastrar on public.recebimentos;
create policy cadastrar on public.recebimentos for insert to authenticated with check ((select public.meu_nivel()) >= 3);
drop policy if exists alterar on public.recebimentos;
create policy alterar on public.recebimentos for update to authenticated
  using ((select public.meu_nivel()) >= 3) with check ((select public.meu_nivel()) >= 3);

drop policy if exists consultar on public.recebimento_itens;
create policy consultar on public.recebimento_itens for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists cadastrar on public.recebimento_itens;
create policy cadastrar on public.recebimento_itens for insert to authenticated with check ((select public.meu_nivel()) >= 3);
drop policy if exists alterar on public.recebimento_itens;
create policy alterar on public.recebimento_itens for update to authenticated
  using ((select public.meu_nivel()) >= 3) with check ((select public.meu_nivel()) >= 3);
drop policy if exists tirar on public.recebimento_itens;
create policy tirar on public.recebimento_itens for delete to authenticated using ((select public.meu_nivel()) >= 3);

revoke delete, truncate on public.recebimentos from anon, authenticated;

-- O histórico do recebimento também aparece para quem não é gestor.
drop policy if exists consultar on public.auditoria;
create policy consultar on public.auditoria for select to authenticated
  using ((select public.meu_nivel()) >= 4
         or ((select public.meu_nivel()) >= 1 and tabela in ('materiais', 'depositos', 'classes', 'recebimentos')));

-- ---------------------------------------------------------------------
-- Ações do recebimento
-- ---------------------------------------------------------------------

-- Itens do checklist da conferência (POP, item 04).
create or replace function public.checklist_completo(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(coalesce((p ->> k)::boolean, false)), false)
    from unnest(array['descricao', 'codigo', 'quantidade', 'unidade', 'condicoes', 'documentacao', 'etiqueta']) as k;
$$;

create or replace function public.registrar_divergencia(p_recebimento bigint, p_descricao text, p_evidencias text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.recebimentos;
  v_nome text;
begin
  if public.meu_nivel() < 3 then
    raise exception 'Seu perfil não registra divergências.';
  end if;
  select * into r from public.recebimentos where id = p_recebimento for update;
  if r.id is null then raise exception 'Recebimento não encontrado.'; end if;
  if r.status not in ('CONFERENCIA', 'DIVERGENTE') then
    raise exception 'O recebimento % já foi encerrado.', r.numero;
  end if;
  if length(btrim(coalesce(p_descricao, ''))) < 10 then
    raise exception 'Descreva a divergência: o que veio diferente da nota.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  perform set_config('app.recebimento', '1', true);
  update public.recebimentos
     set status = 'DIVERGENTE',
         divergencia = btrim(p_descricao),
         evidencias = evidencias || coalesce(p_evidencias, '{}'),
         conferido_por = auth.uid(), conferido_por_nome = v_nome, conferido_em = now()
   where id = p_recebimento;
  perform set_config('app.recebimento', '', true);
end $$;

-- Atualiza o sistema: dá entrada no estoque com as quantidades conferidas.
-- Com divergência, só gestor ou master aprovam (correção autorizada).
create or replace function public.aprovar_recebimento(p_recebimento bigint)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r public.recebimentos;
  i record;
  v_nome text;
  v_divergente boolean;
  v_entradas int := 0;
begin
  if public.meu_nivel() < 3 then
    raise exception 'Seu perfil não aprova recebimentos.';
  end if;
  select * into r from public.recebimentos where id = p_recebimento for update;
  if r.id is null then raise exception 'Recebimento não encontrado.'; end if;
  if r.status not in ('CONFERENCIA', 'DIVERGENTE') then
    raise exception 'O recebimento % já foi encerrado.', r.numero;
  end if;
  if r.nf_arquivo_path is null then
    raise exception 'Anexe a nota fiscal antes de aprovar.';
  end if;
  if not exists (select 1 from public.recebimento_itens where recebimento_id = r.id) then
    raise exception 'O recebimento não tem itens.';
  end if;
  if exists (select 1 from public.recebimento_itens where recebimento_id = r.id and quantidade_conferida is null) then
    raise exception 'Informe a quantidade conferida de todos os itens.';
  end if;
  if not public.checklist_completo(r.checklist) then
    raise exception 'Marque todos os itens do checklist da conferência.';
  end if;
  v_divergente := r.status = 'DIVERGENTE' or exists (
    select 1 from public.recebimento_itens where recebimento_id = r.id and quantidade_conferida <> quantidade_nf);
  if v_divergente and public.meu_nivel() < 4 then
    raise exception 'A conferência não bate com a nota. Registre a divergência para um gestor aprovar.';
  end if;

  for i in select * from public.recebimento_itens where recebimento_id = r.id order by id loop
    if i.quantidade_conferida > 0 then
      perform public.registrar_movimento(i.material_id, 'ENTRADA', i.quantidade_conferida,
        'Recebimento ' || r.numero || case when v_divergente then ' (aprovado com divergência)' else '' end,
        'NF ' || r.nf_numero || coalesce('-' || r.nf_serie, '') || ' · ' || r.fornecedor);
      v_entradas := v_entradas + 1;
    end if;
  end loop;

  select nome into v_nome from public.perfis where id = auth.uid();
  perform set_config('app.recebimento', '1', true);
  update public.recebimentos
     set status = 'APROVADO',
         aprovado_por = auth.uid(), aprovado_por_nome = v_nome, aprovado_em = now(),
         conferido_por = coalesce(conferido_por, auth.uid()),
         conferido_por_nome = coalesce(conferido_por_nome, v_nome),
         conferido_em = coalesce(conferido_em, now())
   where id = r.id;
  perform set_config('app.recebimento', '', true);
  return v_entradas;
end $$;

-- Liberação para organização: material guardado no endereço.
create or replace function public.marcar_guardado(p_recebimento bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if public.meu_nivel() < 3 then
    raise exception 'Seu perfil não registra a guarda.';
  end if;
  if not exists (select 1 from public.recebimentos where id = p_recebimento and status = 'APROVADO') then
    raise exception 'Só recebimentos aprovados podem ser marcados como guardados.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  perform set_config('app.recebimento', '1', true);
  update public.recebimentos
     set status = 'GUARDADO', guardado_por = auth.uid(), guardado_por_nome = v_nome, guardado_em = now()
   where id = p_recebimento;
  perform set_config('app.recebimento', '', true);
end $$;

create or replace function public.cancelar_recebimento(p_recebimento bigint, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.meu_nivel() < 3 then
    raise exception 'Seu perfil não cancela recebimentos.';
  end if;
  if not exists (select 1 from public.recebimentos where id = p_recebimento and status in ('CONFERENCIA', 'DIVERGENTE')) then
    raise exception 'Só recebimentos ainda abertos podem ser cancelados.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  perform set_config('app.recebimento', '1', true);
  update public.recebimentos set status = 'CANCELADO', cancelado_motivo = btrim(p_motivo) where id = p_recebimento;
  perform set_config('app.recebimento', '', true);
end $$;

revoke execute on function public.registrar_divergencia(bigint, text, text[]) from public, anon;
revoke execute on function public.aprovar_recebimento(bigint) from public, anon;
revoke execute on function public.marcar_guardado(bigint) from public, anon;
revoke execute on function public.cancelar_recebimento(bigint, text) from public, anon;
grant execute on function public.registrar_divergencia(bigint, text, text[]) to authenticated;
grant execute on function public.aprovar_recebimento(bigint) to authenticated;
grant execute on function public.marcar_guardado(bigint) to authenticated;
grant execute on function public.cancelar_recebimento(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Arquivos: nota fiscal e fotos de divergência (espaço privado)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recebimentos', 'recebimentos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/xml', 'application/xml'])
on conflict (id) do nothing;

drop policy if exists "recebimentos_ver" on storage.objects;
create policy "recebimentos_ver" on storage.objects for select to authenticated
  using (bucket_id = 'recebimentos' and (select public.meu_nivel()) >= 1);
drop policy if exists "recebimentos_enviar" on storage.objects;
create policy "recebimentos_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'recebimentos' and (select public.meu_nivel()) >= 3);
drop policy if exists "recebimentos_substituir" on storage.objects;
create policy "recebimentos_substituir" on storage.objects for update to authenticated
  using (bucket_id = 'recebimentos' and (select public.meu_nivel()) >= 3)
  with check (bucket_id = 'recebimentos' and (select public.meu_nivel()) >= 3);

-- ---------------------------------------------------------------------
-- Tempo real
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['recebimentos', 'recebimento_itens'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
