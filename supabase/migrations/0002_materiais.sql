-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0002 MATERIAIS
-- Depósitos e endereços, materiais, saldo com movimentações,
-- etiquetas impressas, fotos e fichas no Storage e atualização
-- em tempo real.
--
-- Rode depois do 0001_base.sql: SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Depósitos (estrutura física)
-- ---------------------------------------------------------------------

create table if not exists public.depositos (
  id bigint generated always as identity primary key,
  unidade_id bigint not null references public.unidades (id),
  numero int not null check (numero between 1 and 99),
  nome text,
  prateleiras int not null default 10 check (prateleiras between 1 and 99),
  lados text[] not null default array['A', 'B'] check (lados <@ array['A', 'B'] and cardinality(lados) >= 1),
  andares int not null default 5 check (andares between 1 and 20),
  posicoes int not null default 10 check (posicoes between 1 and 99),
  tipo_armazenagem text not null default 'PRATELEIRA' check (tipo_armazenagem in ('PRATELEIRA', 'PALETE')),
  -- Classes aceitas. Vazio aceita todas.
  classes_permitidas bigint[] not null default '{}',
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
create unique index if not exists depositos_numero_unico on public.depositos (unidade_id, numero) where removido_em is null;

-- ---------------------------------------------------------------------
-- 2. Materiais
-- ---------------------------------------------------------------------

create sequence if not exists public.materiais_codigo_seq;

create table if not exists public.materiais (
  id bigint generated always as identity primary key,
  -- Código interno gerado pelo sistema. Não muda depois de criado.
  codigo text not null unique,
  prn text not null check (length(btrim(prn)) >= 1),
  nome text not null check (length(btrim(nome)) >= 2),
  descricao text,
  marca text,
  classe_id bigint not null references public.classes (id),
  -- Unidade de controle (un, cx, L...) e equivalência da embalagem.
  unidade_medida text not null default 'un',
  embalagem_qtd numeric check (embalagem_qtd is null or embalagem_qtd > 0),
  embalagem_unidade text,
  estoque_minimo numeric not null default 0 check (estoque_minimo >= 0),
  criticidade text not null default 'MEDIA' check (criticidade in ('BAIXA', 'MEDIA', 'ALTA')),
  saldo_emergencial numeric not null default 0 check (saldo_emergencial >= 0),
  -- Só muda por movimentação (função registrar_movimento).
  saldo numeric not null default 0 check (saldo >= 0),
  peso_kg numeric check (peso_kg is null or peso_kg >= 0),
  epi text,
  deposito_id bigint not null references public.depositos (id),
  prateleira int not null check (prateleira >= 1),
  lado text not null check (lado in ('A', 'B')),
  andar int not null check (andar >= 1),
  posicao int not null check (posicao >= 1),
  foto_path text,
  fds_path text,
  relacionados bigint[] not null default '{}',
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
create unique index if not exists materiais_prn_unico on public.materiais (public.normalizar(prn)) where removido_em is null;
-- Uma posição guarda um material só.
create unique index if not exists materiais_posicao_unica on public.materiais (deposito_id, prateleira, lado, andar, posicao) where removido_em is null;
create index if not exists materiais_classe_idx on public.materiais (classe_id);

-- ---------------------------------------------------------------------
-- 3. Movimentações de estoque (nunca são alteradas ou apagadas)
-- ---------------------------------------------------------------------

create table if not exists public.movimentacoes (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  material_id bigint not null references public.materiais (id),
  tipo text not null check (tipo in ('SALDO_INICIAL', 'ENTRADA', 'SAIDA', 'DEVOLUCAO', 'AJUSTE')),
  variacao numeric not null,
  saldo_antes numeric not null,
  saldo_depois numeric not null,
  motivo text,
  documento text,
  usuario_id uuid,
  usuario_nome text
);
create index if not exists movimentacoes_material_idx on public.movimentacoes (material_id, em desc);
create index if not exists movimentacoes_em_idx on public.movimentacoes (em desc);

-- ---------------------------------------------------------------------
-- 4. Etiquetas impressas (para saber quais precisam ser reimpressas)
-- ---------------------------------------------------------------------

create table if not exists public.etiquetas (
  material_id bigint primary key references public.materiais (id) on delete cascade,
  dados jsonb not null,
  impressa_em timestamptz not null default now(),
  impressa_por uuid,
  impressa_por_nome text
);

-- ---------------------------------------------------------------------
-- 5. Regras e gatilhos
-- ---------------------------------------------------------------------

-- O histórico não registra mudança só de saldo: ela já fica nas movimentações.
create or replace function public.registrar_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_acao text;
  v_campos text[];
  v_usuario uuid := public.ator_atual();
  v_nome text;
  v_ignorar text[] := array['criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', 'removido_por', 'saldo'];
begin
  if tg_op = 'INSERT' then
    v_depois := to_jsonb(new);
    v_acao := 'CRIOU';
  elsif tg_op = 'UPDATE' then
    v_antes := to_jsonb(old);
    v_depois := to_jsonb(new);
    select array_agg(k order by k) into v_campos
      from jsonb_object_keys(v_depois) as k
     where not (k = any (v_ignorar))
       and (v_antes -> k) is distinct from (v_depois -> k);
    if v_campos is null then
      return new;
    end if;
    if (v_antes ->> 'removido_em') is null and (v_depois ->> 'removido_em') is not null then
      v_acao := 'REMOVEU';
    elsif (v_antes ->> 'removido_em') is not null and (v_depois ->> 'removido_em') is null then
      v_acao := 'RESTAUROU';
    else
      v_acao := 'EDITOU';
    end if;
  else
    v_antes := to_jsonb(old);
    v_acao := 'EXCLUIU';
  end if;

  select p.nome into v_nome from public.perfis p where p.id = v_usuario;

  insert into public.auditoria (tabela, registro_id, acao, usuario_id, usuario_nome, campos, antes, depois)
  values (
    tg_table_name,
    coalesce(v_depois ->> 'id', v_antes ->> 'id', v_depois ->> 'chave', v_antes ->> 'chave'),
    v_acao,
    v_usuario,
    coalesce(v_nome, case when v_usuario is null then 'Sistema' else 'Usuário removido' end),
    v_campos,
    v_antes,
    v_depois
  );
  return coalesce(new, old);
end $$;

-- Classes: número fixo e não remove classe que ainda tem materiais.
create or replace function public.ajustar_classe()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_qtd int;
begin
  new.nome := btrim(new.nome);
  new.cor := upper(new.cor);
  if tg_op = 'INSERT' then
    new.numero := nextval('public.classes_numero_seq');
  else
    new.numero := old.numero;
    if old.removido_em is null and new.removido_em is not null then
      select count(*) into v_qtd from public.materiais where classe_id = old.id and removido_em is null;
      if v_qtd > 0 then
        raise exception 'A classe % tem % material(is). Escolha para qual classe eles vão antes de remover.', old.nome, v_qtd;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Depósitos: não some com posições ocupadas nem com materiais dentro.
create or replace function public.ajustar_deposito()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_qtd int;
begin
  new.nome := nullif(btrim(coalesce(new.nome, '')), '');
  new.lados := array(select distinct l from unnest(new.lados) as l order by l);
  if tg_op = 'UPDATE' then
    if old.removido_em is null and new.removido_em is not null then
      select count(*) into v_qtd from public.materiais where deposito_id = old.id and removido_em is null;
      if v_qtd > 0 then
        raise exception 'O depósito tem % material(is). Mude os materiais de lugar antes de remover.', v_qtd;
      end if;
    end if;
    select count(*) into v_qtd from public.materiais m
     where m.deposito_id = old.id and m.removido_em is null
       and (m.prateleira > new.prateleiras or m.andar > new.andares or m.posicao > new.posicoes
            or not (m.lado = any (new.lados)));
    if v_qtd > 0 then
      raise exception 'Há % material(is) em posições que deixariam de existir com esse tamanho. Mude esses materiais de lugar antes.', v_qtd;
    end if;
    if cardinality(new.classes_permitidas) > 0 then
      select count(*) into v_qtd from public.materiais m
       where m.deposito_id = old.id and m.removido_em is null
         and not (m.classe_id = any (new.classes_permitidas));
      if v_qtd > 0 then
        raise exception 'Há % material(is) de classes que o depósito deixaria de aceitar. Mude esses materiais antes.', v_qtd;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Materiais: código, saldo protegido, endereço válido e regras do depósito.
create or replace function public.ajustar_material()
returns trigger language plpgsql set search_path = '' as $$
declare
  d public.depositos;
  c public.classes;
  v_local_mudou boolean;
begin
  new.nome := btrim(new.nome);
  new.prn := btrim(new.prn);
  new.descricao := nullif(btrim(coalesce(new.descricao, '')), '');
  new.marca := nullif(btrim(coalesce(new.marca, '')), '');
  new.epi := nullif(btrim(coalesce(new.epi, '')), '');
  new.relacionados := array(select distinct r from unnest(coalesce(new.relacionados, '{}')) as r where r <> new.id order by r);

  if tg_op = 'INSERT' then
    new.codigo := 'MAT-' || lpad(nextval('public.materiais_codigo_seq')::text, 6, '0');
    v_local_mudou := true;
  else
    new.codigo := old.codigo;
    if new.saldo is distinct from old.saldo and coalesce(current_setting('app.movimentando', true), '') <> '1' then
      raise exception 'O saldo só muda por uma movimentação (entrada, saída ou ajuste).';
    end if;
    if old.removido_em is null and new.removido_em is not null and old.saldo > 0 then
      raise exception 'Este material ainda tem saldo de %. Zere o saldo com um ajuste antes de remover.', old.saldo;
    end if;
    v_local_mudou := (new.deposito_id, new.prateleira, new.lado, new.andar, new.posicao, new.classe_id)
      is distinct from (old.deposito_id, old.prateleira, old.lado, old.andar, old.posicao, old.classe_id)
      or (old.removido_em is not null and new.removido_em is null);
  end if;

  if v_local_mudou and new.removido_em is null then
    select * into d from public.depositos where id = new.deposito_id;
    if d.id is null or d.removido_em is not null then
      raise exception 'O depósito escolhido não existe ou foi removido.';
    end if;
    if new.prateleira > d.prateleiras or new.andar > d.andares or new.posicao > d.posicoes or not (new.lado = any (d.lados)) then
      raise exception 'Essa posição não existe no depósito D% (até % prateleiras, % andares e % posições).',
        lpad(d.numero::text, 2, '0'), d.prateleiras, d.andares, d.posicoes;
    end if;
    select * into c from public.classes where id = new.classe_id;
    if c.id is null or c.removido_em is not null then
      raise exception 'A classe escolhida não existe ou foi removida.';
    end if;
    if cardinality(d.classes_permitidas) > 0 and not (new.classe_id = any (d.classes_permitidas)) then
      raise exception 'O depósito D% não aceita materiais da classe %.', lpad(d.numero::text, 2, '0'), c.nome;
    end if;
  end if;
  return new;
end $$;

-- Registra o saldo inicial informado no cadastro.
create or replace function public.saldo_inicial_material()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if new.saldo > 0 then
    select nome into v_nome from public.perfis where id = public.ator_atual();
    insert into public.movimentacoes (material_id, tipo, variacao, saldo_antes, saldo_depois, motivo, usuario_id, usuario_nome)
    values (new.id, 'SALDO_INICIAL', new.saldo, 0, new.saldo, 'Saldo informado no cadastro', public.ator_atual(), coalesce(v_nome, 'Sistema'));
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['depositos', 'materiais'] loop
    execute format('drop trigger if exists a_carimbar on public.%I', t);
    execute format('create trigger a_carimbar before insert or update on public.%I for each row execute function public.carimbar()', t);
    execute format('drop trigger if exists z_auditoria on public.%I', t);
    execute format('create trigger z_auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

drop trigger if exists b_ajustar_deposito on public.depositos;
create trigger b_ajustar_deposito before insert or update on public.depositos
  for each row execute function public.ajustar_deposito();

drop trigger if exists b_ajustar_material on public.materiais;
create trigger b_ajustar_material before insert or update on public.materiais
  for each row execute function public.ajustar_material();

drop trigger if exists c_saldo_inicial on public.materiais;
create trigger c_saldo_inicial after insert on public.materiais
  for each row execute function public.saldo_inicial_material();

-- ---------------------------------------------------------------------
-- 6. Permissões
-- ---------------------------------------------------------------------

alter table public.depositos enable row level security;
alter table public.materiais enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.etiquetas enable row level security;

-- Depósitos: todos consultam; gestor e master alteram.
drop policy if exists consultar on public.depositos;
create policy consultar on public.depositos for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists cadastrar on public.depositos;
create policy cadastrar on public.depositos for insert to authenticated with check ((select public.meu_nivel()) >= 4);
drop policy if exists alterar on public.depositos;
create policy alterar on public.depositos for update to authenticated
  using ((select public.meu_nivel()) >= 4) with check ((select public.meu_nivel()) >= 4);

-- Materiais: todos consultam; almoxarife, gestor e master cadastram e editam.
drop policy if exists consultar on public.materiais;
create policy consultar on public.materiais for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists cadastrar on public.materiais;
create policy cadastrar on public.materiais for insert to authenticated with check ((select public.meu_nivel()) >= 3);
drop policy if exists alterar on public.materiais;
create policy alterar on public.materiais for update to authenticated
  using ((select public.meu_nivel()) >= 3) with check ((select public.meu_nivel()) >= 3);

drop policy if exists consultar on public.movimentacoes;
create policy consultar on public.movimentacoes for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists consultar on public.etiquetas;
create policy consultar on public.etiquetas for select to authenticated using ((select public.meu_nivel()) >= 1);

revoke delete, truncate on public.depositos, public.materiais from anon, authenticated;
revoke insert, update, delete, truncate on public.movimentacoes, public.etiquetas from anon, authenticated;

-- Histórico: gestor e master veem tudo; os demais veem o histórico de
-- materiais, depósitos e classes (rastreabilidade de quem alterou o item).
drop policy if exists consultar on public.auditoria;
create policy consultar on public.auditoria for select to authenticated
  using ((select public.meu_nivel()) >= 4
         or ((select public.meu_nivel()) >= 1 and tabela in ('materiais', 'depositos', 'classes')));

-- ---------------------------------------------------------------------
-- 7. Funções chamadas pela tela
-- ---------------------------------------------------------------------

-- Única forma de mudar o saldo. Trava o material durante a operação,
-- para duas retiradas ao mesmo tempo nunca deixarem saldo negativo.
create or replace function public.registrar_movimento(
  p_material bigint, p_tipo text, p_variacao numeric, p_motivo text default null, p_documento text default null)
returns public.movimentacoes language plpgsql security definer set search_path = '' as $$
declare
  v_saldo numeric;
  v_novo numeric;
  v_nome text;
  v public.movimentacoes;
begin
  select saldo into v_saldo from public.materiais where id = p_material and removido_em is null for update;
  if v_saldo is null then
    raise exception 'Material não encontrado.';
  end if;
  if coalesce(p_variacao, 0) = 0 then
    raise exception 'A quantidade da movimentação não pode ser zero.';
  end if;
  v_novo := v_saldo + p_variacao;
  if v_novo < 0 then
    raise exception 'Saldo insuficiente: há % e a operação pede %.', v_saldo, abs(p_variacao);
  end if;
  perform set_config('app.movimentando', '1', true);
  update public.materiais set saldo = v_novo where id = p_material;
  perform set_config('app.movimentando', '', true);
  select nome into v_nome from public.perfis where id = public.ator_atual();
  insert into public.movimentacoes (material_id, tipo, variacao, saldo_antes, saldo_depois, motivo, documento, usuario_id, usuario_nome)
  values (p_material, p_tipo, p_variacao, v_saldo, v_novo, nullif(btrim(coalesce(p_motivo, '')), ''),
          nullif(btrim(coalesce(p_documento, '')), ''), public.ator_atual(), coalesce(v_nome, 'Sistema'))
  returning * into v;
  return v;
end $$;

revoke execute on function public.registrar_movimento(bigint, text, numeric, text, text) from public, anon, authenticated;

-- Ajuste de saldo com motivo obrigatório. Só gestor e master.
create or replace function public.ajustar_saldo(p_material bigint, p_novo_saldo numeric, p_motivo text)
returns public.movimentacoes language plpgsql security definer set search_path = '' as $$
declare
  v_saldo numeric;
begin
  if public.meu_nivel() < 4 then
    raise exception 'Somente gestor e master ajustam saldo.';
  end if;
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'O novo saldo não pode ser negativo.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Explique o motivo do ajuste.';
  end if;
  select saldo into v_saldo from public.materiais where id = p_material and removido_em is null for update;
  if v_saldo is null then
    raise exception 'Material não encontrado.';
  end if;
  if v_saldo = p_novo_saldo then
    raise exception 'O saldo informado é igual ao atual.';
  end if;
  return public.registrar_movimento(p_material, 'AJUSTE', p_novo_saldo - v_saldo, p_motivo, null);
end $$;

-- Remove uma classe levando os materiais dela para outra classe.
create or replace function public.remover_classe(p_classe bigint, p_destino bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_qtd int;
begin
  if public.meu_nivel() < 4 then
    raise exception 'Somente gestor e master removem classes.';
  end if;
  select count(*) into v_qtd from public.materiais where classe_id = p_classe and removido_em is null;
  if v_qtd > 0 then
    if p_destino is null then
      raise exception 'A classe tem % material(is). Escolha para qual classe eles vão.', v_qtd;
    end if;
    if p_destino = p_classe or not exists (select 1 from public.classes where id = p_destino and removido_em is null) then
      raise exception 'Escolha outra classe ativa para receber os materiais.';
    end if;
    update public.materiais set classe_id = p_destino where classe_id = p_classe and removido_em is null;
  end if;
  update public.classes set removido_em = now() where id = p_classe and removido_em is null;
end $$;

-- Guarda o que foi impresso em cada etiqueta.
create or replace function public.registrar_etiquetas(p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_nome text;
  v_qtd int := 0;
begin
  if public.meu_nivel() < 3 then
    raise exception 'Seu perfil não imprime etiquetas.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into public.etiquetas (material_id, dados, impressa_em, impressa_por, impressa_por_nome)
    values ((v_item ->> 'material_id')::bigint, v_item -> 'dados', now(), auth.uid(), v_nome)
    on conflict (material_id) do update
      set dados = excluded.dados, impressa_em = excluded.impressa_em,
          impressa_por = excluded.impressa_por, impressa_por_nome = excluded.impressa_por_nome;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

revoke execute on function public.ajustar_saldo(bigint, numeric, text) from public, anon;
revoke execute on function public.remover_classe(bigint, bigint) from public, anon;
revoke execute on function public.registrar_etiquetas(jsonb) from public, anon;
grant execute on function public.ajustar_saldo(bigint, numeric, text) to authenticated;
grant execute on function public.remover_classe(bigint, bigint) to authenticated;
grant execute on function public.registrar_etiquetas(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Configurações das regras de armazenagem
-- ---------------------------------------------------------------------

insert into public.configuracoes (chave, valor, descricao) values
  ('peso_pesado_kg', '15', 'A partir deste peso (kg) o material é considerado pesado.'),
  ('andar_maximo_pesado', '2', 'Materiais pesados devem ficar até este andar (o andar 1 é o mais baixo).')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 9. Fotos e fichas de segurança (Storage)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materiais', 'materiais', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "materiais_ver" on storage.objects;
create policy "materiais_ver" on storage.objects for select to authenticated
  using (bucket_id = 'materiais');
drop policy if exists "materiais_enviar" on storage.objects;
create policy "materiais_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'materiais' and (select public.meu_nivel()) >= 3);
drop policy if exists "materiais_substituir" on storage.objects;
create policy "materiais_substituir" on storage.objects for update to authenticated
  using (bucket_id = 'materiais' and (select public.meu_nivel()) >= 3)
  with check (bucket_id = 'materiais' and (select public.meu_nivel()) >= 3);
drop policy if exists "materiais_apagar" on storage.objects;
create policy "materiais_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'materiais' and (select public.meu_nivel()) >= 3);

-- ---------------------------------------------------------------------
-- 10. Atualização em tempo real
-- As telas recebem cada mudança no instante em que ela acontece.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['perfis', 'unidades', 'setores', 'classes', 'configuracoes', 'auditoria',
                           'sessoes_ativas', 'depositos', 'materiais', 'movimentacoes', 'etiquetas'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
