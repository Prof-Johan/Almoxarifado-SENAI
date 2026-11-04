-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0004 PEDIDOS, INVENTÁRIO E RELATÓRIOS
-- Pedido pelo setor, aprovação (opcional e para saldo emergencial),
-- separação, retirada com crachá ou foto, devolução, prazo de 7 dias,
-- inventário periódico com ajuste autorizado, rotatividade e
-- relatório semanal automático.
--
-- Rode depois do 0003_recebimento.sql: SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pedidos
-- ---------------------------------------------------------------------

create sequence if not exists public.pedidos_numero_seq;

create table if not exists public.pedidos (
  id bigint generated always as identity primary key,
  numero text not null unique,
  unidade_id bigint not null references public.unidades (id),
  setor_id bigint references public.setores (id),
  solicitante_id uuid not null references auth.users (id),
  solicitante_nome text,
  status text not null default 'PENDENTE' check (status in
    ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO', 'RETIRADO', 'EXPIRADO', 'CANCELADO', 'RECUSADO')),
  usa_emergencial boolean not null default false,
  prazo_retirada timestamptz not null,
  observacao text,
  anexo_path text,
  anexo_nome text,
  aprovado_por uuid, aprovado_por_nome text, aprovado_em timestamptz,
  separado_por uuid, separado_por_nome text, separado_em timestamptz,
  retirado_em timestamptz,
  retirada_metodo text check (retirada_metodo in ('CRACHA', 'FOTO')),
  retirada_foto_path text,
  recebedor_id uuid, recebedor_nome text,
  entregue_por uuid, entregue_por_nome text,
  motivo_encerramento text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
create index if not exists pedidos_status_idx on public.pedidos (status, criado_em desc);
create index if not exists pedidos_solicitante_idx on public.pedidos (solicitante_id);

create table if not exists public.pedido_itens (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos (id) on delete cascade,
  material_id bigint not null references public.materiais (id),
  quantidade numeric not null check (quantidade > 0),
  -- Motivo da retirada: uso comum, reposição de item perdido ou sem condições de uso.
  categoria text not null default 'COMUM' check (categoria in ('COMUM', 'PERDIDO', 'SEM_CONDICOES')),
  quantidade_separada numeric check (quantidade_separada is null or quantidade_separada >= 0),
  quantidade_entregue numeric check (quantidade_entregue is null or quantidade_entregue >= 0),
  quantidade_devolvida numeric not null default 0 check (quantidade_devolvida >= 0),
  constraint pedido_itens_material_unico unique (pedido_id, material_id)
);
create index if not exists pedido_itens_material_idx on public.pedido_itens (material_id);

drop trigger if exists a_carimbar on public.pedidos;
create trigger a_carimbar before insert or update on public.pedidos for each row execute function public.carimbar();
drop trigger if exists z_auditoria on public.pedidos;
create trigger z_auditoria after insert or update or delete on public.pedidos for each row execute function public.registrar_auditoria();

alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;

-- Solicitante vê os próprios pedidos; almoxarife, gestor, master e consulta veem todos.
drop policy if exists consultar on public.pedidos;
create policy consultar on public.pedidos for select to authenticated
  using (solicitante_id = auth.uid() or (select public.meu_nivel()) >= 3 or (select public.meu_perfil()) = 'CONSULTA');
drop policy if exists consultar on public.pedido_itens;
create policy consultar on public.pedido_itens for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id
                  and (p.solicitante_id = auth.uid() or (select public.meu_nivel()) >= 3 or (select public.meu_perfil()) = 'CONSULTA')));
-- Pedidos só mudam pelas funções abaixo.
revoke insert, update, delete, truncate on public.pedidos, public.pedido_itens from anon, authenticated;

-- Quanto de cada material está reservado em pedidos abertos.
create or replace function public.reservado_material(p_material bigint, p_ignorar_pedido bigint default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce(i.quantidade_separada, i.quantidade)), 0)
    from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
   where i.material_id = p_material
     and p.status in ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO')
     and p.prazo_retirada >= now()
     and p.id is distinct from p_ignorar_pedido;
$$;

create or replace function public.reservas()
returns table (material_id bigint, reservado numeric) language sql stable security definer set search_path = '' as $$
  select i.material_id, sum(coalesce(i.quantidade_separada, i.quantidade))
    from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
   where p.status in ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO') and p.prazo_retirada >= now()
   group by i.material_id;
$$;

create or replace function public.rotulo_categoria(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'PERDIDO' then 'reposição de item perdido'
                when 'SEM_CONDICOES' then 'reposição de item sem condições de uso'
                else 'uso comum' end;
$$;

-- Pedido do setor. Confere o saldo disponível (saldo menos reservas).
-- Usar o saldo emergencial ou a regra "exigir aprovação" manda para o gestor.
create or replace function public.criar_pedido(p_dados jsonb)
returns public.pedidos language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfis;
  v_item record;
  v_mat public.materiais;
  v_disp numeric;
  v_emerg boolean := false;
  v_prazo int;
  v_exigir boolean;
  v_ped public.pedidos;
begin
  select * into v_perfil from public.perfis where id = auth.uid() and ativo and removido_em is null;
  if v_perfil.id is null or public.nivel_perfil(v_perfil.perfil) < 2 then
    raise exception 'Seu perfil não faz pedidos de material.';
  end if;
  if jsonb_array_length(coalesce(p_dados -> 'itens', '[]'::jsonb)) = 0 then
    raise exception 'Inclua pelo menos um material no pedido.';
  end if;
  if (select count(*) from jsonb_array_elements(p_dados -> 'itens'))
     <> (select count(distinct value ->> 'material_id') from jsonb_array_elements(p_dados -> 'itens')) then
    raise exception 'Um material aparece duas vezes no pedido. Junte as quantidades em uma linha.';
  end if;
  select coalesce((valor #>> '{}')::int, 7) into v_prazo from public.configuracoes where chave = 'prazo_retirada_dias';
  select coalesce((valor #>> '{}')::boolean, false) into v_exigir from public.configuracoes where chave = 'exigir_aprovacao_pedidos';

  -- Trava os materiais na mesma ordem para dois pedidos não brigarem pelo mesmo saldo.
  for v_item in
    select (value ->> 'material_id')::bigint as material_id, (value ->> 'quantidade')::numeric as quantidade
      from jsonb_array_elements(p_dados -> 'itens') order by 1
  loop
    select * into v_mat from public.materiais where id = v_item.material_id and removido_em is null for update;
    if v_mat.id is null then raise exception 'Um dos materiais não existe ou foi removido.'; end if;
    if coalesce(v_item.quantidade, 0) <= 0 then raise exception 'Informe a quantidade de %.', v_mat.nome; end if;
    v_disp := v_mat.saldo - public.reservado_material(v_mat.id);
    if v_item.quantidade > v_disp then
      raise exception 'Saldo insuficiente de %: há % % disponível(is).', v_mat.nome, greatest(v_disp, 0), v_mat.unidade_medida;
    end if;
    if v_item.quantidade > v_disp - v_mat.saldo_emergencial then
      v_emerg := true;
    end if;
  end loop;

  insert into public.pedidos (numero, unidade_id, setor_id, solicitante_id, solicitante_nome, status,
                              usa_emergencial, prazo_retirada, observacao, anexo_path, anexo_nome)
  values (
    'PED-' || lpad(nextval('public.pedidos_numero_seq')::text, 6, '0'),
    coalesce(nullif(p_dados ->> 'unidade_id', '')::bigint, v_perfil.unidade_id,
             (select id from public.unidades where removido_em is null order by id limit 1)),
    coalesce(nullif(p_dados ->> 'setor_id', '')::bigint, v_perfil.setor_id),
    v_perfil.id, v_perfil.nome,
    case when v_emerg or v_exigir then 'AGUARDANDO_APROVACAO' else 'PENDENTE' end,
    v_emerg,
    now() + make_interval(days => v_prazo),
    nullif(btrim(coalesce(p_dados ->> 'observacao', '')), ''),
    nullif(p_dados ->> 'anexo_path', ''),
    nullif(p_dados ->> 'anexo_nome', ''))
  returning * into v_ped;

  insert into public.pedido_itens (pedido_id, material_id, quantidade, categoria)
  select v_ped.id, (value ->> 'material_id')::bigint, (value ->> 'quantidade')::numeric,
         coalesce(nullif(value ->> 'categoria', ''), 'COMUM')
    from jsonb_array_elements(p_dados -> 'itens');
  return v_ped;
end $$;

-- Gestor aprova ou recusa (pedidos com saldo emergencial ou com a regra ligada).
create or replace function public.aprovar_pedido(p_pedido bigint, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if public.meu_nivel() < 4 then raise exception 'Somente gestor e master aprovam pedidos.'; end if;
  if not exists (select 1 from public.pedidos where id = p_pedido and status = 'AGUARDANDO_APROVACAO') then
    raise exception 'Este pedido não está aguardando aprovação.';
  end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Explique o motivo da recusa.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  update public.pedidos
     set status = case when p_aprovar then 'PENDENTE' else 'RECUSADO' end,
         aprovado_por = auth.uid(), aprovado_por_nome = v_nome, aprovado_em = now(),
         motivo_encerramento = case when p_aprovar then null else btrim(p_motivo) end
   where id = p_pedido;
end $$;

-- Marca como vencidos os pedidos não retirados no prazo.
create or replace function public.expirar_pedidos()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_qtd int;
begin
  update public.pedidos
     set status = 'EXPIRADO', motivo_encerramento = 'Prazo de retirada vencido'
   where status in ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO') and prazo_retirada < now();
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Separação: o almoxarife informa quanto separou de cada item.
create or replace function public.separar_pedido(p_pedido bigint, p_itens jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
  v_item record;
  v_mat public.materiais;
  v_sep numeric;
  v_disp numeric;
  v_total numeric := 0;
  v_nome text;
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não separa pedidos.'; end if;
  select * into v_ped from public.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status not in ('PENDENTE', 'SEPARADO') then raise exception 'O pedido % não está liberado para separação.', v_ped.numero; end if;
  if v_ped.prazo_retirada < now() then
    perform public.expirar_pedidos();
    raise exception 'O prazo de retirada do pedido % venceu.', v_ped.numero;
  end if;
  for v_item in select * from public.pedido_itens where pedido_id = p_pedido order by material_id loop
    select (x ->> 'quantidade_separada')::numeric into v_sep
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x where (x ->> 'id')::bigint = v_item.id;
    v_sep := coalesce(v_sep, v_item.quantidade);
    select * into v_mat from public.materiais where id = v_item.material_id for update;
    if v_sep < 0 or v_sep > v_item.quantidade then
      raise exception 'A quantidade separada de % precisa ficar entre 0 e %.', v_mat.nome, v_item.quantidade;
    end if;
    v_disp := v_mat.saldo - public.reservado_material(v_mat.id, p_pedido);
    if v_sep > v_disp then
      raise exception 'Saldo insuficiente para separar %: há % % disponível(is).', v_mat.nome, greatest(v_disp, 0), v_mat.unidade_medida;
    end if;
    update public.pedido_itens set quantidade_separada = v_sep where id = v_item.id;
    v_total := v_total + v_sep;
  end loop;
  if v_total = 0 then
    raise exception 'Nenhum item foi separado. Se não há material, cancele o pedido.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  update public.pedidos set status = 'SEPARADO', separado_por = auth.uid(), separado_por_nome = v_nome, separado_em = now()
   where id = p_pedido;
end $$;

-- Retirada: só com crachá cadastrado ou foto (assinar para receber).
create or replace function public.confirmar_retirada(
  p_pedido bigint, p_metodo text, p_cracha text default null, p_foto_path text default null, p_recebedor_nome text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
  v_rec public.perfis;
  v_recebedor text;
  v_item record;
  v_nome text;
  v_itens jsonb := '[]'::jsonb;
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não registra retiradas.'; end if;
  select * into v_ped from public.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status <> 'SEPARADO' then raise exception 'O pedido % ainda não foi separado.', v_ped.numero; end if;
  if v_ped.prazo_retirada < now() then
    perform public.expirar_pedidos();
    raise exception 'O prazo de retirada do pedido % venceu.', v_ped.numero;
  end if;
  if p_metodo = 'CRACHA' then
    select * into v_rec from public.perfis
     where upper(regexp_replace(cracha, '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce(p_cracha, ''), '[^0-9A-Za-z]', '', 'g'))
       and length(regexp_replace(coalesce(p_cracha, ''), '[^0-9A-Za-z]', '', 'g')) > 0 and ativo and removido_em is null;
    if v_rec.id is null then raise exception 'Crachá não cadastrado ou de conta bloqueada.'; end if;
    v_recebedor := v_rec.nome;
  elsif p_metodo = 'FOTO' then
    if p_foto_path is null then raise exception 'Tire a foto de quem está retirando.'; end if;
    if length(btrim(coalesce(p_recebedor_nome, ''))) < 3 then raise exception 'Informe o nome de quem está retirando.'; end if;
    v_recebedor := btrim(p_recebedor_nome);
  else
    raise exception 'Escolha como confirmar a retirada: crachá ou foto.';
  end if;

  for v_item in
    select i.*, m.nome, m.unidade_medida from public.pedido_itens i join public.materiais m on m.id = i.material_id
     where i.pedido_id = p_pedido and coalesce(i.quantidade_separada, 0) > 0 order by i.material_id
  loop
    perform public.registrar_movimento(v_item.material_id, 'SAIDA', -v_item.quantidade_separada,
      'Pedido ' || v_ped.numero || ', ' || public.rotulo_categoria(v_item.categoria),
      'Retirado por ' || v_recebedor);
    update public.pedido_itens set quantidade_entregue = v_item.quantidade_separada where id = v_item.id;
    v_itens := v_itens || jsonb_build_object('nome', v_item.nome, 'quantidade', v_item.quantidade_separada, 'unidade', v_item.unidade_medida);
  end loop;

  select nome into v_nome from public.perfis where id = auth.uid();
  update public.pedidos
     set status = 'RETIRADO', retirado_em = now(), retirada_metodo = p_metodo, retirada_foto_path = p_foto_path,
         recebedor_id = v_rec.id, recebedor_nome = v_recebedor, entregue_por = auth.uid(), entregue_por_nome = v_nome
   where id = p_pedido;
  return jsonb_build_object('numero', v_ped.numero, 'recebedor', v_recebedor,
                            'outra_pessoa', v_rec.id is not null and v_rec.id <> v_ped.solicitante_id, 'itens', v_itens);
end $$;

create or replace function public.cancelar_pedido(p_pedido bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
begin
  select * into v_ped from public.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status not in ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO') then raise exception 'O pedido % já foi encerrado.', v_ped.numero; end if;
  if v_ped.solicitante_id <> auth.uid() then
    if public.meu_nivel() < 3 then raise exception 'Você só pode cancelar os seus pedidos.'; end if;
    if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Explique o motivo do cancelamento.'; end if;
  end if;
  update public.pedidos set status = 'CANCELADO', motivo_encerramento = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Cancelado pelo solicitante')
   where id = p_pedido;
end $$;

-- Devolução de material já retirado (o erro se corrige devolvendo, não apagando).
create or replace function public.registrar_devolucao(
  p_material bigint, p_quantidade numeric, p_motivo text default null, p_pedido_item bigint default null)
returns public.movimentacoes language plpgsql security definer set search_path = '' as $$
declare
  v_item record;
  v_doc text;
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não registra devoluções.'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe a quantidade devolvida.'; end if;
  if p_pedido_item is not null then
    select i.*, p.numero, p.status into v_item
      from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id where i.id = p_pedido_item for update of i;
    if v_item.id is null or v_item.material_id <> p_material then raise exception 'Item do pedido não encontrado.'; end if;
    if v_item.status <> 'RETIRADO' then raise exception 'Só dá para devolver itens de pedidos retirados.'; end if;
    if v_item.quantidade_devolvida + p_quantidade > coalesce(v_item.quantidade_entregue, 0) then
      raise exception 'A devolução passa do que foi entregue (% entregue, % já devolvido).', v_item.quantidade_entregue, v_item.quantidade_devolvida;
    end if;
    update public.pedido_itens set quantidade_devolvida = quantidade_devolvida + p_quantidade where id = p_pedido_item;
    v_doc := 'Pedido ' || v_item.numero;
  end if;
  return public.registrar_movimento(p_material, 'DEVOLUCAO', p_quantidade, coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Devolução'), v_doc);
end $$;

-- ---------------------------------------------------------------------
-- 2. Inventário periódico (POP, item 10)
-- ---------------------------------------------------------------------

create sequence if not exists public.inventarios_numero_seq;

create table if not exists public.inventarios (
  id bigint generated always as identity primary key,
  numero text not null unique,
  deposito_id bigint not null references public.depositos (id),
  status text not null default 'ABERTO' check (status in ('ABERTO', 'CONCLUIDO', 'CANCELADO')),
  observacao text,
  aberto_por_nome text,
  concluido_por uuid, concluido_por_nome text, concluido_em timestamptz,
  ajustes_aplicados int not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);

create table if not exists public.inventario_itens (
  id bigint generated always as identity primary key,
  inventario_id bigint not null references public.inventarios (id) on delete cascade,
  material_id bigint not null references public.materiais (id),
  saldo_sistema numeric not null,
  quantidade_contada numeric check (quantidade_contada is null or quantidade_contada >= 0),
  observacao text,
  contado_por_nome text,
  constraint inventario_itens_material_unico unique (inventario_id, material_id)
);

drop trigger if exists a_carimbar on public.inventarios;
create trigger a_carimbar before insert or update on public.inventarios for each row execute function public.carimbar();
drop trigger if exists z_auditoria on public.inventarios;
create trigger z_auditoria after insert or update or delete on public.inventarios for each row execute function public.registrar_auditoria();

-- Na contagem, só a quantidade contada e a observação podem mudar.
create or replace function public.ajustar_inventario_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select status from public.inventarios where id = old.inventario_id) <> 'ABERTO' then
    raise exception 'Este inventário já foi encerrado.';
  end if;
  new.inventario_id := old.inventario_id;
  new.material_id := old.material_id;
  new.saldo_sistema := old.saldo_sistema;
  new.observacao := nullif(btrim(coalesce(new.observacao, '')), '');
  if new.quantidade_contada is distinct from old.quantidade_contada then
    select nome into new.contado_por_nome from public.perfis where id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists b_ajustar_item on public.inventario_itens;
create trigger b_ajustar_item before update on public.inventario_itens for each row execute function public.ajustar_inventario_item();

alter table public.inventarios enable row level security;
alter table public.inventario_itens enable row level security;
drop policy if exists consultar on public.inventarios;
create policy consultar on public.inventarios for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists consultar on public.inventario_itens;
create policy consultar on public.inventario_itens for select to authenticated using ((select public.meu_nivel()) >= 1);
drop policy if exists contar on public.inventario_itens;
create policy contar on public.inventario_itens for update to authenticated
  using ((select public.meu_nivel()) >= 3) with check ((select public.meu_nivel()) >= 3);
revoke insert, update, delete, truncate on public.inventarios from anon, authenticated;
revoke insert, delete, truncate on public.inventario_itens from anon, authenticated;

create or replace function public.criar_inventario(p_deposito bigint, p_observacao text default null)
returns public.inventarios language plpgsql security definer set search_path = '' as $$
declare
  v public.inventarios;
  v_nome text;
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não abre inventários.'; end if;
  if not exists (select 1 from public.depositos where id = p_deposito and removido_em is null) then
    raise exception 'Depósito não encontrado.';
  end if;
  if exists (select 1 from public.inventarios where deposito_id = p_deposito and status = 'ABERTO') then
    raise exception 'Já existe um inventário aberto neste depósito. Conclua ou cancele antes.';
  end if;
  if not exists (select 1 from public.materiais where deposito_id = p_deposito and removido_em is null) then
    raise exception 'O depósito não tem materiais para contar.';
  end if;
  select nome into v_nome from public.perfis where id = auth.uid();
  insert into public.inventarios (numero, deposito_id, observacao, aberto_por_nome)
  values ('INV-' || lpad(nextval('public.inventarios_numero_seq')::text, 6, '0'), p_deposito,
          nullif(btrim(coalesce(p_observacao, '')), ''), v_nome)
  returning * into v;
  insert into public.inventario_itens (inventario_id, material_id, saldo_sistema)
  select v.id, m.id, m.saldo from public.materiais m where m.deposito_id = p_deposito and m.removido_em is null;
  return v;
end $$;

-- Conclui o inventário. Divergências viram ajustes, autorizados por gestor ou master.
-- O ajuste é a diferença da contagem, então movimentações feitas durante a contagem continuam valendo.
create or replace function public.concluir_inventario(p_inventario bigint)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v public.inventarios;
  v_item record;
  v_ajustes int := 0;
  v_nome text;
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não conclui inventários.'; end if;
  select * into v from public.inventarios where id = p_inventario for update;
  if v.id is null or v.status <> 'ABERTO' then raise exception 'Este inventário não está aberto.'; end if;
  if not exists (select 1 from public.inventario_itens where inventario_id = v.id and quantidade_contada is not null) then
    raise exception 'Nenhum item foi contado ainda.';
  end if;
  if exists (select 1 from public.inventario_itens where inventario_id = v.id and quantidade_contada is not null and quantidade_contada <> saldo_sistema)
     and public.meu_nivel() < 4 then
    raise exception 'Há divergências entre o contado e o sistema. Um gestor precisa autorizar os ajustes.';
  end if;
  for v_item in
    select i.*, m.nome from public.inventario_itens i join public.materiais m on m.id = i.material_id
     where i.inventario_id = v.id and i.quantidade_contada is not null and i.quantidade_contada <> i.saldo_sistema
     order by i.material_id
  loop
    perform public.registrar_movimento(v_item.material_id, 'AJUSTE', v_item.quantidade_contada - v_item.saldo_sistema,
      'Inventário ' || v.numero || ': contado ' || v_item.quantidade_contada || ', sistema ' || v_item.saldo_sistema
        || coalesce('. ' || v_item.observacao, ''),
      'Inventário ' || v.numero);
    v_ajustes := v_ajustes + 1;
  end loop;
  select nome into v_nome from public.perfis where id = auth.uid();
  update public.inventarios set status = 'CONCLUIDO', concluido_por = auth.uid(), concluido_por_nome = v_nome,
         concluido_em = now(), ajustes_aplicados = v_ajustes
   where id = v.id;
  return v_ajustes;
end $$;

create or replace function public.cancelar_inventario(p_inventario bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.meu_nivel() < 3 then raise exception 'Seu perfil não cancela inventários.'; end if;
  update public.inventarios set status = 'CANCELADO' where id = p_inventario and status = 'ABERTO';
  if not found then raise exception 'Este inventário não está aberto.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Rotatividade e relatório semanal
-- ---------------------------------------------------------------------

-- Rotatividade em 3 níveis, pela quantidade de retiradas nos últimos dias.
-- Os 20% mais retirados são "alta", os 30% seguintes "média" e o resto "baixa".
create or replace function public.rotatividade(p_dias int default 90)
returns table (material_id bigint, retiradas int, quantidade numeric, nivel text)
language sql stable security definer set search_path = '' as $$
  with saidas as (
    select mv.material_id, count(*)::int as retiradas, sum(-mv.variacao) as quantidade
      from public.movimentacoes mv
     where mv.tipo = 'SAIDA' and mv.em >= now() - make_interval(days => p_dias)
     group by mv.material_id),
  posicao as (select s.*, percent_rank() over (order by s.retiradas desc, s.quantidade desc) as pr from saidas s)
  select p.material_id, p.retiradas, p.quantidade,
         case when p.pr < 0.2 then 'ALTA' when p.pr < 0.5 then 'MEDIA' else 'BAIXA' end
    from posicao p;
$$;

create table if not exists public.relatorios_semanais (
  id bigint generated always as identity primary key,
  periodo_inicio date not null unique,
  periodo_fim date not null,
  dados jsonb not null,
  gerado_em timestamptz not null default now(),
  gerado_por_nome text
);
alter table public.relatorios_semanais enable row level security;
drop policy if exists consultar on public.relatorios_semanais;
create policy consultar on public.relatorios_semanais for select to authenticated using ((select public.meu_nivel()) >= 3);
revoke insert, update, delete, truncate on public.relatorios_semanais from anon, authenticated;

-- Resumo dos últimos 7 dias. Roda sozinho toda segunda (veja o fim do arquivo)
-- e também pelo botão "Gerar agora" da página Relatórios.
create or replace function public.gerar_relatorio_semanal(p_fim date default current_date)
returns public.relatorios_semanais language plpgsql security definer set search_path = '' as $$
declare
  v_ini date := p_fim - 6;
  v_ate timestamptz := (p_fim + 1)::timestamptz;
  v_dados jsonb;
  v public.relatorios_semanais;
begin
  if auth.uid() is not null and public.meu_nivel() < 3 then
    raise exception 'Seu perfil não gera relatórios.';
  end if;
  select jsonb_build_object(
    'movimentos', (select coalesce(jsonb_object_agg(tipo, jsonb_build_object('lancamentos', n, 'quantidade', q)), '{}')
                     from (select tipo, count(*) n, sum(abs(variacao)) q from public.movimentacoes
                            where em >= v_ini and em < v_ate group by tipo) t),
    'pedidos', (select coalesce(jsonb_object_agg(status, n), '{}')
                  from (select status, count(*) n from public.pedidos where criado_em >= v_ini and criado_em < v_ate group by status) t),
    'recebimentos', (select coalesce(jsonb_object_agg(status, n), '{}')
                       from (select status, count(*) n from public.recebimentos where criado_em >= v_ini and criado_em < v_ate group by status) t),
    'abaixo_minimo', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'saldo', saldo,
                                     'minimo', estoque_minimo, 'unidade', unidade_medida) order by saldo), '[]')
                        from public.materiais where removido_em is null and saldo <= estoque_minimo),
    'mais_retirados', (select coalesce(jsonb_agg(x order by (x ->> 'quantidade')::numeric desc), '[]') from (
                         select jsonb_build_object('codigo', m.codigo, 'nome', m.nome, 'quantidade', sum(-mv.variacao),
                                                   'retiradas', count(*), 'unidade', m.unidade_medida) x
                           from public.movimentacoes mv join public.materiais m on m.id = mv.material_id
                          where mv.tipo = 'SAIDA' and mv.em >= v_ini and mv.em < v_ate
                          group by m.id order by sum(-mv.variacao) desc limit 10) t)
  ) into v_dados;
  insert into public.relatorios_semanais (periodo_inicio, periodo_fim, dados, gerado_em, gerado_por_nome)
  values (v_ini, p_fim, v_dados, now(), coalesce((select nome from public.perfis where id = auth.uid()), 'Automático'))
  on conflict (periodo_inicio) do update
    set periodo_fim = excluded.periodo_fim, dados = excluded.dados, gerado_em = excluded.gerado_em, gerado_por_nome = excluded.gerado_por_nome
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 4. Permissões das funções
-- ---------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.reservas()', 'public.criar_pedido(jsonb)', 'public.aprovar_pedido(bigint, boolean, text)',
    'public.expirar_pedidos()', 'public.separar_pedido(bigint, jsonb)',
    'public.confirmar_retirada(bigint, text, text, text, text)', 'public.cancelar_pedido(bigint, text)',
    'public.registrar_devolucao(bigint, numeric, text, bigint)', 'public.criar_inventario(bigint, text)',
    'public.concluir_inventario(bigint)', 'public.cancelar_inventario(bigint)', 'public.rotatividade(int)',
    'public.gerar_relatorio_semanal(date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.reservado_material(bigint, bigint) from public, anon, authenticated;

-- O histórico de pedidos e inventários também aparece para quem não é gestor.
drop policy if exists consultar on public.auditoria;
create policy consultar on public.auditoria for select to authenticated
  using ((select public.meu_nivel()) >= 4
         or ((select public.meu_nivel()) >= 1 and tabela in ('materiais', 'depositos', 'classes', 'recebimentos', 'pedidos', 'inventarios')));

-- ---------------------------------------------------------------------
-- 5. Arquivos dos pedidos: anexo do solicitante e foto da retirada (privado)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "pedidos_ver" on storage.objects;
create policy "pedidos_ver" on storage.objects for select to authenticated
  using (bucket_id = 'pedidos' and (select public.meu_nivel()) >= 1);
drop policy if exists "pedidos_enviar" on storage.objects;
create policy "pedidos_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'pedidos' and (select public.meu_nivel()) >= 2);

-- ---------------------------------------------------------------------
-- 6. Tempo real
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['pedidos', 'pedido_itens', 'inventarios', 'inventario_itens', 'relatorios_semanais'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Tarefas automáticas (opcional)
-- Ative a extensão pg_cron em Database > Extensions e rode este arquivo de novo.
-- Relatório toda segunda às 7h (horário de Brasília) e pedidos vencidos a cada hora.
-- Sem o pg_cron, o sistema expira os pedidos quando alguém abre a página de pedidos.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('almox-relatorio-semanal', '0 10 * * 1', 'select public.gerar_relatorio_semanal()');
    perform cron.schedule('almox-expirar-pedidos', '5 * * * *', 'select public.expirar_pedidos()');
  end if;
end $$;
