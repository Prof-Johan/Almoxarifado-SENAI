-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0007 QUANTIDADE INTEIRA
-- Materiais contados em unidade, peça, caixa, rolo etc. só aceitam
-- números inteiros: não dá para pedir, separar, retirar, devolver,
-- receber ou contar 0,4 rolamento. Só metro, quilo, grama, litro e
-- mililitro aceitam número com vírgula.
-- A regra fica no banco, então vale para qualquer tela.
--
-- Rode depois do 0006_prn_usuarios.sql. Pode ser executado mais de uma vez.
-- =====================================================================

-- Unidades que podem ser divididas.
create or replace function public.unidade_fracionavel(p_unidade text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_unidade, ''))) in ('m', 'kg', 'g', 'l', 'ml');
$$;

-- Recusa número com vírgula quando a unidade não pode ser dividida.
create or replace function public.exigir_inteiro(p_qtd numeric, p_unidade text, p_material text, p_campo text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_qtd is not null and p_qtd <> trunc(p_qtd) and not public.unidade_fracionavel(p_unidade) then
    raise exception '% de % precisa ser um número inteiro: o material é controlado em % (%), que não se divide.',
      p_campo, coalesce(p_material, 'material'), lower(coalesce(p_unidade, '')), replace(abs(p_qtd)::text, '.', ',');
  end if;
end $$;

-- 1. Cadastro do material: mínimo e saldo emergencial; o saldo, quando a unidade muda.
create or replace function public.conferir_inteiro_material()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mudou_unidade boolean := tg_op = 'INSERT' or new.unidade_medida is distinct from old.unidade_medida;
begin
  if v_mudou_unidade or new.estoque_minimo is distinct from old.estoque_minimo then
    perform public.exigir_inteiro(new.estoque_minimo, new.unidade_medida, new.nome, 'O estoque mínimo');
  end if;
  if v_mudou_unidade or new.saldo_emergencial is distinct from old.saldo_emergencial then
    perform public.exigir_inteiro(new.saldo_emergencial, new.unidade_medida, new.nome, 'O saldo emergencial');
  end if;
  if v_mudou_unidade then
    perform public.exigir_inteiro(new.saldo, new.unidade_medida, new.nome, 'O saldo');
  end if;
  return new;
end $$;

drop trigger if exists b_quantidade_inteira on public.materiais;
create trigger b_quantidade_inteira before insert or update on public.materiais
  for each row execute function public.conferir_inteiro_material();

-- 2. Movimentações (entrada, saída, devolução, saldo inicial e ajuste).
-- O ajuste pode corrigir um saldo quebrado antigo, desde que termine inteiro.
create or replace function public.conferir_inteiro_movimento()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mat record;
begin
  select nome, unidade_medida into v_mat from public.materiais where id = new.material_id;
  if new.tipo = 'AJUSTE' then
    perform public.exigir_inteiro(new.saldo_depois, v_mat.unidade_medida, v_mat.nome, 'O saldo ajustado');
  else
    perform public.exigir_inteiro(new.variacao, v_mat.unidade_medida, v_mat.nome, 'A quantidade');
  end if;
  return new;
end $$;

drop trigger if exists b_quantidade_inteira on public.movimentacoes;
create trigger b_quantidade_inteira before insert on public.movimentacoes
  for each row execute function public.conferir_inteiro_movimento();

-- 3. Itens de pedido: pedida, separada, entregue e devolvida.
create or replace function public.conferir_inteiro_pedido_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mat record;
begin
  select nome, unidade_medida into v_mat from public.materiais where id = new.material_id;
  if tg_op = 'INSERT' or new.quantidade is distinct from old.quantidade then
    perform public.exigir_inteiro(new.quantidade, v_mat.unidade_medida, v_mat.nome, 'A quantidade pedida');
  end if;
  if tg_op = 'INSERT' or new.quantidade_separada is distinct from old.quantidade_separada then
    perform public.exigir_inteiro(new.quantidade_separada, v_mat.unidade_medida, v_mat.nome, 'A quantidade separada');
  end if;
  if tg_op = 'INSERT' or new.quantidade_entregue is distinct from old.quantidade_entregue then
    perform public.exigir_inteiro(new.quantidade_entregue, v_mat.unidade_medida, v_mat.nome, 'A quantidade entregue');
  end if;
  if tg_op = 'INSERT' or new.quantidade_devolvida is distinct from old.quantidade_devolvida then
    perform public.exigir_inteiro(new.quantidade_devolvida, v_mat.unidade_medida, v_mat.nome, 'A quantidade devolvida');
  end if;
  return new;
end $$;

drop trigger if exists b_quantidade_inteira on public.pedido_itens;
create trigger b_quantidade_inteira before insert or update on public.pedido_itens
  for each row execute function public.conferir_inteiro_pedido_item();

-- 4. Itens de recebimento: quantidade da nota e conferida.
create or replace function public.conferir_inteiro_recebimento_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mat record;
begin
  select nome, unidade_medida into v_mat from public.materiais where id = new.material_id;
  if tg_op = 'INSERT' or new.quantidade_nf is distinct from old.quantidade_nf then
    perform public.exigir_inteiro(new.quantidade_nf, v_mat.unidade_medida, v_mat.nome, 'A quantidade da nota');
  end if;
  if tg_op = 'INSERT' or new.quantidade_conferida is distinct from old.quantidade_conferida then
    perform public.exigir_inteiro(new.quantidade_conferida, v_mat.unidade_medida, v_mat.nome, 'A quantidade conferida');
  end if;
  return new;
end $$;

drop trigger if exists b_quantidade_inteira on public.recebimento_itens;
create trigger b_quantidade_inteira before insert or update on public.recebimento_itens
  for each row execute function public.conferir_inteiro_recebimento_item();

-- 5. Inventário: quantidade contada.
create or replace function public.conferir_inteiro_inventario_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mat record;
begin
  if tg_op = 'INSERT' or new.quantidade_contada is distinct from old.quantidade_contada then
    select nome, unidade_medida into v_mat from public.materiais where id = new.material_id;
    perform public.exigir_inteiro(new.quantidade_contada, v_mat.unidade_medida, v_mat.nome, 'A quantidade contada');
  end if;
  return new;
end $$;

drop trigger if exists b_quantidade_inteira on public.inventario_itens;
create trigger b_quantidade_inteira before insert or update on public.inventario_itens
  for each row execute function public.conferir_inteiro_inventario_item();

-- 6. O que já entrou quebrado antes desta regra.
-- Materiais com saldo quebrado: corrija com "Ajustar saldo" (gestor ou master).
-- Pedidos em aberto com quantidade quebrada: cancele e peça de novo.
select 'Saldo quebrado' as problema, m.codigo as referencia, m.nome as material,
       m.saldo::text || ' ' || m.unidade_medida as quantidade
  from public.materiais m
 where m.removido_em is null and m.saldo <> trunc(m.saldo) and not public.unidade_fracionavel(m.unidade_medida)
union all
select 'Pedido em aberto com quantidade quebrada', p.numero, m.nome,
       coalesce(i.quantidade_separada, i.quantidade)::text || ' ' || m.unidade_medida
  from public.pedido_itens i
  join public.pedidos p on p.id = i.pedido_id
  join public.materiais m on m.id = i.material_id
 where p.status in ('AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO')
   and not public.unidade_fracionavel(m.unidade_medida)
   and (i.quantidade <> trunc(i.quantidade) or coalesce(i.quantidade_separada, 0) <> trunc(coalesce(i.quantidade_separada, 0)))
order by 1, 2;
