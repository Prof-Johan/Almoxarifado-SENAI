-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0006 PRN DO USUÁRIO E E-MAIL REAPROVEITÁVEL
-- - O PRN é o código da pessoa na empresa (a antiga "matrícula"), com
--   exatamente 8 dígitos. Serve para entrar no sistema e para confirmar
--   a retirada de material. O campo crachá deixa de ser usado.
-- - E-mail e PRN de um usuário removido podem ser usados num cadastro
--   novo. O usuário removido continua no histórico.
--
-- Rode depois do 0005_centro_custo.sql. Pode ser executado mais de uma vez.
-- =====================================================================

-- 1. E-mail, PRN e crachá só precisam ser únicos entre os usuários não removidos.
alter table public.perfis drop constraint if exists perfis_email_key;
alter table public.perfis drop constraint if exists perfis_matricula_key;
alter table public.perfis drop constraint if exists perfis_cracha_key;
create unique index if not exists perfis_email_key on public.perfis (email) where removido_em is null;
create unique index if not exists perfis_matricula_key on public.perfis (matricula) where removido_em is null;
create unique index if not exists perfis_cracha_key on public.perfis (cracha) where removido_em is null;

-- 2. PRN com exatamente 8 dígitos. Vale para cadastros novos e para quando
-- o PRN muda; usuários antigos fora do padrão continuam entrando até serem editados.
create or replace function public.conferir_prn()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.matricula := nullif(btrim(coalesce(new.matricula, '')), '');
  if new.matricula is not null
     and (tg_op = 'INSERT' or new.matricula is distinct from old.matricula)
     and new.matricula !~ '^[0-9]{8}$' then
    raise exception 'O PRN precisa ter exatamente 8 dígitos, só números.';
  end if;
  return new;
end $$;

drop trigger if exists perfis_conferir_prn on public.perfis;
create trigger perfis_conferir_prn before insert or update of matricula on public.perfis
  for each row execute function public.conferir_prn();

-- 3. Retirada confirmada pelo PRN de quem está levando.
create or replace function public.confirmar_retirada(
  p_pedido bigint, p_metodo text, p_cracha text default null, p_foto_path text default null, p_recebedor_nome text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
  v_rec public.perfis;
  v_prn text := regexp_replace(coalesce(p_cracha, ''), '[^0-9]', '', 'g');
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
    if length(v_prn) <> 8 then raise exception 'Digite o PRN com 8 dígitos.'; end if;
    select * into v_rec from public.perfis
     where matricula = v_prn and ativo and removido_em is null;
    if v_rec.id is null then raise exception 'PRN % não cadastrado ou de conta bloqueada.', v_prn; end if;
    v_recebedor := v_rec.nome;
  elsif p_metodo = 'FOTO' then
    if p_foto_path is null then raise exception 'Tire a foto de quem está retirando.'; end if;
    if length(btrim(coalesce(p_recebedor_nome, ''))) < 3 then raise exception 'Informe o nome de quem está retirando.'; end if;
    v_recebedor := btrim(p_recebedor_nome);
  else
    raise exception 'Escolha como confirmar a retirada: PRN ou foto.';
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

-- 4. Usuários com PRN fora do padrão de 8 dígitos (corrija pela tela de Usuários).
select nome, email, matricula as prn_atual
  from public.perfis
 where removido_em is null and (matricula is null or matricula !~ '^[0-9]{8}$')
 order by nome;
