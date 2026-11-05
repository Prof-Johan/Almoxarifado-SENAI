-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0005 ESTOQUE POR SETOR E CENTRO DE CUSTO
-- Cada setor tem o seu centro de custo e as classes que pode pedir.
-- Um material pode pertencer a um centro de custo: só o setor dono pede.
-- O mesmo material (ex.: copos) pode existir em dois centros de custo,
-- cada um com o seu saldo.
--
-- Rode depois do 0004_pedidos_relatorios.sql. Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.setores add column if not exists codigo_centro_custo text;
alter table public.setores add column if not exists classes_permitidas bigint[] not null default '{}';
alter table public.materiais add column if not exists centro_custo_id bigint references public.setores (id);

-- O PRN se repete só em centros de custo diferentes.
drop index if exists public.materiais_prn_unico;
create unique index if not exists materiais_prn_centro_unico on public.materiais
  (public.normalizar(prn), coalesce(centro_custo_id, 0)) where removido_em is null;
create index if not exists materiais_centro_idx on public.materiais (centro_custo_id);

-- Confere o centro de custo do material.
create or replace function public.conferir_centro_custo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.centro_custo_id is not null and new.removido_em is null
     and (tg_op = 'INSERT' or new.centro_custo_id is distinct from old.centro_custo_id)
     and not exists (select 1 from public.setores where id = new.centro_custo_id and removido_em is null) then
    raise exception 'O setor escolhido como centro de custo não existe ou foi removido.';
  end if;
  return new;
end $$;
drop trigger if exists b_centro_custo on public.materiais;
create trigger b_centro_custo before insert or update on public.materiais
  for each row execute function public.conferir_centro_custo();

-- Não remove um setor que ainda é dono de materiais.
create or replace function public.ajustar_setor()
returns trigger language plpgsql set search_path = '' as $$
declare v_qtd int;
begin
  new.codigo_centro_custo := nullif(btrim(coalesce(new.codigo_centro_custo, '')), '');
  new.classes_permitidas := array(select distinct c from unnest(coalesce(new.classes_permitidas, '{}')) as c order by c);
  if tg_op = 'UPDATE' and old.removido_em is null and new.removido_em is not null then
    select count(*) into v_qtd from public.materiais where centro_custo_id = old.id and removido_em is null;
    if v_qtd > 0 then
      raise exception 'O setor é centro de custo de % material(is). Mude o centro de custo deles antes de remover.', v_qtd;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_ajustar_setor on public.setores;
create trigger b_ajustar_setor before insert or update on public.setores
  for each row execute function public.ajustar_setor();

-- Pedido: confere setor, centro de custo e classes permitidas.
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
  v_setor public.setores;
  v_setor_id bigint;
  v_classe text;
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
  -- O solicitante pede sempre pelo próprio setor; almoxarife, gestor e master podem pedir por outro.
  if public.nivel_perfil(v_perfil.perfil) < 3 then
    v_setor_id := v_perfil.setor_id;
    if v_setor_id is null then
      raise exception 'Seu usuário não tem setor. Peça ao gestor para incluir o setor no seu cadastro.';
    end if;
  else
    v_setor_id := coalesce(nullif(p_dados ->> 'setor_id', '')::bigint, v_perfil.setor_id);
  end if;
  if v_setor_id is null then raise exception 'Escolha o setor solicitante.'; end if;
  select * into v_setor from public.setores where id = v_setor_id and removido_em is null;
  if v_setor.id is null then raise exception 'O setor escolhido não existe ou foi removido.'; end if;

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
    -- Estoque por centro de custo: o material de um setor só sai para esse setor.
    if v_mat.centro_custo_id is not null and v_mat.centro_custo_id <> v_setor.id then
      raise exception '% pertence ao centro de custo de outro setor e não pode ser pedido por %.', v_mat.nome, v_setor.nome;
    end if;
    -- Classes que o setor pode pedir (vazio libera todas).
    if cardinality(v_setor.classes_permitidas) > 0 and not (v_mat.classe_id = any (v_setor.classes_permitidas)) then
      select nome into v_classe from public.classes where id = v_mat.classe_id;
      raise exception 'O setor % não pode pedir materiais da classe % (%).', v_setor.nome, v_classe, v_mat.nome;
    end if;
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
    v_setor.id,
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


revoke execute on function public.criar_pedido(jsonb) from public, anon;
grant execute on function public.criar_pedido(jsonb) to authenticated;
