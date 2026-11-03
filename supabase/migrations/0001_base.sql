-- =====================================================================
-- ALMOXARIFADO INTELIGENTE - 0001 BASE
-- Usuários e hierarquia, unidades, setores, classes de cor,
-- configurações, histórico de auditoria e sessão única por conta.
--
-- Como usar: Supabase > SQL Editor > New query > cole este arquivo > Run.
-- O script pode ser executado mais de uma vez sem duplicar dados.
-- =====================================================================

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Funções utilitárias
-- ---------------------------------------------------------------------

-- Texto sem acento e em minúsculas (busca e nomes únicos).
create or replace function public.normalizar(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(btrim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))));
$$;

-- Nível de cada perfil. Quanto maior, mais permissões.
create or replace function public.nivel_perfil(p text)
returns int language sql immutable parallel safe set search_path = '' as $$
  select case p
    when 'MASTER' then 5
    when 'GESTOR' then 4
    when 'ALMOXARIFE' then 3
    when 'SOLICITANTE' then 2
    when 'CONSULTA' then 1
    else 0 end;
$$;

-- Quem está fazendo a operação: o usuário logado ou, quando a função
-- de servidor age em nome de alguém, o valor de app.ator.
create or replace function public.ator_atual()
returns uuid language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.ator', true), '')::uuid);
$$;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- Todas as tabelas principais têm as mesmas colunas de rastreabilidade:
-- criado_em/por, atualizado_em/por e removido_em/por (remoção lógica).
-- ---------------------------------------------------------------------

create table if not exists public.unidades (
  id bigint generated always as identity primary key,
  nome text not null check (length(btrim(nome)) >= 2),
  sigla text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
create unique index if not exists unidades_nome_unico on public.unidades (public.normalizar(nome)) where removido_em is null;

create table if not exists public.setores (
  id bigint generated always as identity primary key,
  nome text not null check (length(btrim(nome)) >= 2),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
create unique index if not exists setores_nome_unico on public.setores (public.normalizar(nome)) where removido_em is null;

create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (length(btrim(nome)) >= 2),
  email text,
  matricula text,
  cracha text,
  perfil text not null check (perfil in ('MASTER', 'GESTOR', 'ALMOXARIFE', 'SOLICITANTE', 'CONSULTA')),
  unidade_id bigint references public.unidades (id),
  setor_id bigint references public.setores (id),
  empresa text,
  ativo boolean not null default true,
  deve_trocar_senha boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid,
  constraint perfis_email_key unique (email),
  constraint perfis_matricula_key unique (matricula),
  constraint perfis_cracha_key unique (cracha)
);
create index if not exists perfis_perfil_idx on public.perfis (perfil);

create sequence if not exists public.classes_numero_seq;

create table if not exists public.classes (
  id bigint generated always as identity primary key,
  -- Número fixo da classe. Nunca é reaproveitado, nem depois de remover.
  numero int not null unique,
  nome text not null check (length(btrim(nome)) >= 2),
  cor text not null check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  descricao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);
alter table public.classes alter column numero drop default;
alter sequence public.classes_numero_seq owned by public.classes.numero;
create unique index if not exists classes_nome_unico on public.classes (public.normalizar(nome)) where removido_em is null;

create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null,
  descricao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  removido_em timestamptz,
  removido_por uuid
);

-- Histórico de quem criou, editou, removeu ou restaurou cada registro.
-- Ninguém consegue alterar ou apagar estas linhas pelo sistema.
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tabela text not null,
  registro_id text,
  acao text not null check (acao in ('CRIOU', 'EDITOU', 'REMOVEU', 'RESTAUROU', 'EXCLUIU')),
  usuario_id uuid,
  usuario_nome text,
  campos text[],
  antes jsonb,
  depois jsonb
);
create index if not exists auditoria_em_idx on public.auditoria (em desc);
create index if not exists auditoria_registro_idx on public.auditoria (tabela, registro_id);
create index if not exists auditoria_usuario_idx on public.auditoria (usuario_id);

-- Uma sessão válida por conta. O login mais recente derruba o anterior.
create table if not exists public.sessoes_ativas (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  sessao_id uuid not null,
  iniciada_em timestamptz not null default now(),
  dispositivo text
);

-- ---------------------------------------------------------------------
-- 3. Gatilhos de rastreabilidade
-- ---------------------------------------------------------------------

-- Preenche automaticamente quem criou, editou e removeu.
-- O sistema não aceita esses valores vindos da tela.
create or replace function public.carimbar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.criado_por := public.ator_atual();
    new.atualizado_em := new.criado_em;
    new.atualizado_por := new.criado_por;
    new.removido_em := null;
    new.removido_por := null;
  else
    new.criado_em := old.criado_em;
    new.criado_por := old.criado_por;
    new.atualizado_em := now();
    new.atualizado_por := public.ator_atual();
    if old.removido_em is null and new.removido_em is not null then
      new.removido_em := now();
      new.removido_por := new.atualizado_por;
    elsif new.removido_em is null then
      new.removido_por := null;
    else
      new.removido_em := old.removido_em;
      new.removido_por := old.removido_por;
    end if;
  end if;
  return new;
end $$;

-- Grava cada criação, edição, remoção e restauração no histórico.
create or replace function public.registrar_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_acao text;
  v_campos text[];
  v_usuario uuid := public.ator_atual();
  v_nome text;
  v_ignorar text[] := array['criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', 'removido_por'];
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

-- Regras específicas das classes: número fixo, cor em maiúsculas.
create or replace function public.ajustar_classe()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.nome := btrim(new.nome);
  new.cor := upper(new.cor);
  if tg_op = 'INSERT' then
    new.numero := nextval('public.classes_numero_seq');
  else
    new.numero := old.numero;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['unidades', 'setores', 'perfis', 'classes', 'configuracoes'] loop
    execute format('drop trigger if exists a_carimbar on public.%I', t);
    execute format('create trigger a_carimbar before insert or update on public.%I for each row execute function public.carimbar()', t);
    execute format('drop trigger if exists z_auditoria on public.%I', t);
    execute format('create trigger z_auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

drop trigger if exists b_ajustar_classe on public.classes;
create trigger b_ajustar_classe before insert or update on public.classes
  for each row execute function public.ajustar_classe();

-- ---------------------------------------------------------------------
-- 4. Permissões por perfil
-- ---------------------------------------------------------------------

create or replace function public.meu_perfil()
returns text language sql stable security definer set search_path = '' as $$
  select p.perfil from public.perfis p
   where p.id = auth.uid() and p.ativo and p.removido_em is null;
$$;

create or replace function public.meu_nivel()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(public.nivel_perfil(public.meu_perfil()), 0);
$$;

alter table public.unidades enable row level security;
alter table public.setores enable row level security;
alter table public.perfis enable row level security;
alter table public.classes enable row level security;
alter table public.configuracoes enable row level security;
alter table public.auditoria enable row level security;
alter table public.sessoes_ativas enable row level security;

-- Unidades, setores e classes: todos consultam, gestor e master alteram.
do $$
declare t text;
begin
  foreach t in array array['unidades', 'setores', 'classes', 'configuracoes'] loop
    execute format('drop policy if exists consultar on public.%I', t);
    execute format('create policy consultar on public.%I for select to authenticated using ((select public.meu_nivel()) >= 1)', t);
    execute format('drop policy if exists cadastrar on public.%I', t);
    execute format('create policy cadastrar on public.%I for insert to authenticated with check ((select public.meu_nivel()) >= 4)', t);
    execute format('drop policy if exists alterar on public.%I', t);
    execute format('create policy alterar on public.%I for update to authenticated using ((select public.meu_nivel()) >= 4) with check ((select public.meu_nivel()) >= 4)', t);
  end loop;
end $$;

-- Usuários: cada um vê a própria conta; almoxarife, gestor e master veem todas.
-- Criar e alterar contas só pela função de servidor gerenciar-usuario.
drop policy if exists consultar on public.perfis;
create policy consultar on public.perfis for select to authenticated
  using (id = auth.uid() or (select public.meu_nivel()) >= 3);

-- Histórico: gestor e master consultam. Ninguém insere, altera ou apaga.
drop policy if exists consultar on public.auditoria;
create policy consultar on public.auditoria for select to authenticated
  using ((select public.meu_nivel()) >= 4);
revoke insert, update, delete, truncate on public.auditoria from anon, authenticated;

drop policy if exists consultar on public.sessoes_ativas;
create policy consultar on public.sessoes_ativas for select to authenticated
  using (usuario_id = auth.uid());

-- Nada é apagado de verdade pelo sistema: remoção é lógica.
revoke delete, truncate on public.unidades, public.setores, public.perfis, public.classes, public.configuracoes from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Funções chamadas pela tela
-- ---------------------------------------------------------------------

-- Login por matrícula: devolve o e-mail de acesso da conta.
create or replace function public.email_para_login(p_login text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when position('@' in coalesce(p_login, '')) > 0 then lower(btrim(p_login))
    else (
      select u.email from auth.users u
        join public.perfis p on p.id = u.id
       where lower(p.matricula) = lower(btrim(p_login))
         and p.removido_em is null
       limit 1)
  end;
$$;

-- Registra a sessão atual como a única válida da conta.
create or replace function public.registrar_sessao(p_sessao uuid, p_dispositivo text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.sessoes_ativas (usuario_id, sessao_id, iniciada_em, dispositivo)
  values (auth.uid(), p_sessao, now(), left(p_dispositivo, 200))
  on conflict (usuario_id) do update
    set sessao_id = excluded.sessao_id,
        iniciada_em = excluded.iniciada_em,
        dispositivo = excluded.dispositivo;
$$;

-- Situação da sessão: 'ok', 'outra_sessao' ou 'sem_acesso'.
create or replace function public.situacao_sessao(p_sessao uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (
      select 1 from public.perfis p
       where p.id = auth.uid() and p.ativo and p.removido_em is null) then 'sem_acesso'
    when exists (
      select 1 from public.sessoes_ativas s
       where s.usuario_id = auth.uid() and s.sessao_id = p_sessao) then 'ok'
    else 'outra_sessao'
  end;
$$;

-- Depois que o usuário define a própria senha.
create or replace function public.confirmar_troca_senha()
returns void language sql security definer set search_path = '' as $$
  update public.perfis set deve_trocar_senha = false where id = auth.uid();
$$;

revoke execute on function public.email_para_login(text) from public;
grant execute on function public.email_para_login(text) to anon, authenticated;
revoke execute on function public.registrar_sessao(uuid, text) from public, anon;
revoke execute on function public.situacao_sessao(uuid) from public, anon;
revoke execute on function public.confirmar_troca_senha() from public, anon;
grant execute on function public.registrar_sessao(uuid, text) to authenticated;
grant execute on function public.situacao_sessao(uuid) to authenticated;
grant execute on function public.confirmar_troca_senha() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Hierarquia: regras para criar e alterar usuários
-- Usadas só pela função de servidor gerenciar-usuario.
-- ---------------------------------------------------------------------

create or replace function public.validar_gestao_usuario(
  p_ator uuid, p_alvo uuid, p_perfil text, p_ativo boolean, p_removido boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_ator public.perfis;
  v_alvo public.perfis;
  v_nivel_ator int;
  v_perfil_final text;
  v_outros_masters int;
begin
  select * into v_ator from public.perfis where id = p_ator;
  if v_ator.id is null or not v_ator.ativo or v_ator.removido_em is not null then
    raise exception 'Sua conta não tem acesso para gerenciar usuários.';
  end if;
  v_nivel_ator := public.nivel_perfil(v_ator.perfil);
  if v_nivel_ator < 4 then
    raise exception 'Somente gestor e master gerenciam usuários.';
  end if;
  if p_perfil is not null and public.nivel_perfil(p_perfil) = 0 then
    raise exception 'Perfil inválido.';
  end if;

  if p_alvo is not null then
    select * into v_alvo from public.perfis where id = p_alvo;
    if v_alvo.id is null then
      raise exception 'Usuário não encontrado.';
    end if;
  elsif p_perfil is null then
    raise exception 'Escolha o perfil do usuário.';
  end if;

  -- A própria conta: pode editar dados, mas não perfil, bloqueio ou remoção.
  if p_alvo = p_ator then
    if coalesce(p_perfil, v_ator.perfil) <> v_ator.perfil
       or coalesce(p_ativo, true) = false
       or coalesce(p_removido, false) then
      raise exception 'Você não pode alterar o próprio perfil, bloquear ou remover a própria conta.';
    end if;
    return;
  end if;

  v_perfil_final := coalesce(p_perfil, v_alvo.perfil);

  -- Quem não é master só gerencia perfis abaixo do seu.
  if v_ator.perfil <> 'MASTER' then
    if v_alvo.id is not null and public.nivel_perfil(v_alvo.perfil) >= v_nivel_ator then
      raise exception 'Sua hierarquia não permite alterar esta conta.';
    end if;
    if public.nivel_perfil(v_perfil_final) >= v_nivel_ator then
      raise exception 'Você só pode atribuir perfis abaixo do seu.';
    end if;
  end if;

  -- Sempre precisa existir pelo menos uma conta master ativa.
  if v_alvo.id is not null and v_alvo.perfil = 'MASTER' and v_alvo.ativo and v_alvo.removido_em is null
     and (v_perfil_final <> 'MASTER' or coalesce(p_ativo, true) = false or coalesce(p_removido, false)) then
    select count(*) into v_outros_masters from public.perfis
     where perfil = 'MASTER' and ativo and removido_em is null and id <> v_alvo.id;
    if v_outros_masters = 0 then
      raise exception 'O sistema precisa de pelo menos uma conta master ativa.';
    end if;
  end if;
end $$;

-- Cria ou atualiza o perfil de um usuário em nome de quem pediu (p_ator).
-- p_dados aceita: nome, email, matricula, cracha, perfil, unidade_id,
-- setor_id, empresa, ativo, deve_trocar_senha, removido (true/false).
create or replace function public.salvar_perfil_usuario(p_ator uuid, p_id uuid, p_dados jsonb)
returns public.perfis language plpgsql security definer set search_path = '' as $$
declare
  v_existe boolean;
  v public.perfis;
begin
  v_existe := exists (select 1 from public.perfis where id = p_id);

  perform public.validar_gestao_usuario(
    p_ator,
    case when v_existe then p_id end,
    nullif(p_dados ->> 'perfil', ''),
    (p_dados ->> 'ativo')::boolean,
    (p_dados ->> 'removido')::boolean);

  perform set_config('app.ator', p_ator::text, true);

  if not v_existe then
    insert into public.perfis (id, nome, email, matricula, cracha, perfil, unidade_id, setor_id, empresa, ativo, deve_trocar_senha)
    values (
      p_id,
      btrim(p_dados ->> 'nome'),
      nullif(lower(btrim(p_dados ->> 'email')), ''),
      nullif(btrim(p_dados ->> 'matricula'), ''),
      nullif(btrim(p_dados ->> 'cracha'), ''),
      p_dados ->> 'perfil',
      nullif(p_dados ->> 'unidade_id', '')::bigint,
      nullif(p_dados ->> 'setor_id', '')::bigint,
      nullif(btrim(p_dados ->> 'empresa'), ''),
      coalesce((p_dados ->> 'ativo')::boolean, true),
      coalesce((p_dados ->> 'deve_trocar_senha')::boolean, false))
    returning * into v;
  else
    update public.perfis p set
      nome = case when p_dados ? 'nome' then btrim(p_dados ->> 'nome') else p.nome end,
      email = case when p_dados ? 'email' then nullif(lower(btrim(p_dados ->> 'email')), '') else p.email end,
      matricula = case when p_dados ? 'matricula' then nullif(btrim(p_dados ->> 'matricula'), '') else p.matricula end,
      cracha = case when p_dados ? 'cracha' then nullif(btrim(p_dados ->> 'cracha'), '') else p.cracha end,
      perfil = coalesce(nullif(p_dados ->> 'perfil', ''), p.perfil),
      unidade_id = case when p_dados ? 'unidade_id' then nullif(p_dados ->> 'unidade_id', '')::bigint else p.unidade_id end,
      setor_id = case when p_dados ? 'setor_id' then nullif(p_dados ->> 'setor_id', '')::bigint else p.setor_id end,
      empresa = case when p_dados ? 'empresa' then nullif(btrim(p_dados ->> 'empresa'), '') else p.empresa end,
      ativo = coalesce((p_dados ->> 'ativo')::boolean, p.ativo),
      deve_trocar_senha = coalesce((p_dados ->> 'deve_trocar_senha')::boolean, p.deve_trocar_senha),
      removido_em = case
        when p_dados ? 'removido' then case when (p_dados ->> 'removido')::boolean then now() else null end
        else p.removido_em end
    where p.id = p_id
    returning * into v;
  end if;
  return v;
end $$;

revoke execute on function public.validar_gestao_usuario(uuid, uuid, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.salvar_perfil_usuario(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.validar_gestao_usuario(uuid, uuid, text, boolean, boolean) to service_role;
grant execute on function public.salvar_perfil_usuario(uuid, uuid, jsonb) to service_role;

-- Define a conta master. Rode no SQL Editor depois de criar o usuário em
-- Authentication > Users. Exemplo:
--   select public.definir_master('seu.email@exemplo.com', 'Seu Nome');
create or replace function public.definir_master(p_email text, p_nome text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Não existe usuário com o e-mail % em Authentication > Users. Crie o usuário primeiro.', p_email;
  end if;
  insert into public.perfis (id, nome, email, perfil)
  values (v_id, btrim(p_nome), lower(btrim(p_email)), 'MASTER')
  on conflict (id) do update
    set perfil = 'MASTER', ativo = true, removido_em = null, nome = excluded.nome;
  return 'Conta master definida para ' || lower(btrim(p_email));
end $$;

revoke execute on function public.definir_master(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Dados iniciais
-- ---------------------------------------------------------------------

insert into public.unidades (nome, sigla)
select 'Otacílio Costa', 'OTC'
where not exists (select 1 from public.unidades);

-- Classes da tabela enviada pelo Jean. Podem ser editadas ou removidas.
insert into public.classes (nome, cor)
select v.nome, v.cor
from (values
  (1, 'Elétrica', '#F0C51A'),
  (2, 'Mecânica', '#35A05F'),
  (3, 'Segurança', '#F88A0D'),
  (4, 'Administrativo', '#FFFFFF'),
  (5, 'Limpeza', '#852ADF'),
  (6, 'Químicos', '#FF4DD8'),
  (7, 'Produção', '#6F6D6D'),
  (8, 'Insumos', '#322FF4')
) as v (ordem, nome, cor)
where not exists (select 1 from public.classes)
order by v.ordem;

insert into public.configuracoes (chave, valor, descricao) values
  ('exigir_aprovacao_pedidos', 'false', 'Quando ligado, todo pedido precisa ser aprovado antes da separação.'),
  ('prazo_retirada_dias', '7', 'Dias para retirar o material depois do pedido.')
on conflict (chave) do nothing;
