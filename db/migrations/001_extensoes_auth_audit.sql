-- =====================================================================
-- 001 · Extensões, segurança (auth + RBAC hierárquico) e trilha de auditoria
-- Idempotente: pode ser reaplicada com segurança.
-- =====================================================================

create extension if not exists citext;    -- e-mail case-insensitive
create extension if not exists pgcrypto;  -- gen_random_uuid(), hashing

create schema if not exists sec;
create schema if not exists audit;

-- ---------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------
create table if not exists sec.usuario (
  id              uuid primary key default gen_random_uuid(),
  email           citext unique not null,
  nome            text not null,
  senha_hash      text not null,                 -- bcrypt/argon2 (gerado na aplicação)
  ativo           boolean not null default true,
  mfa_habilitado  boolean not null default false,
  mfa_secret      text,
  ultimo_login    timestamptz,
  falhas_login    smallint not null default 0,
  bloqueado_ate   timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfis hierárquicos (RBAC)
-- Um perfil pode herdar de um perfil-pai; a resolução de permissões
-- efetivas percorre a árvore (feita na aplicação ou via a view abaixo).
-- ---------------------------------------------------------------------
create table if not exists sec.perfil (
  id             uuid primary key default gen_random_uuid(),
  codigo         text unique not null,
  nome           text not null,
  descricao      text,
  perfil_pai_id  uuid references sec.perfil(id) on delete set null,
  nivel          smallint not null default 0,      -- 0 = mais alto na hierarquia
  criado_em      timestamptz not null default now()
);

create table if not exists sec.permissao (
  id         uuid primary key default gen_random_uuid(),
  codigo     text unique not null,   -- ex.: 'ativo.boleta.importar'
  modulo     text not null,          -- ex.: 'ativo'
  descricao  text
);

create table if not exists sec.perfil_permissao (
  perfil_id     uuid not null references sec.perfil(id) on delete cascade,
  permissao_id  uuid not null references sec.permissao(id) on delete cascade,
  primary key (perfil_id, permissao_id)
);

create table if not exists sec.usuario_perfil (
  usuario_id  uuid not null references sec.usuario(id) on delete cascade,
  perfil_id   uuid not null references sec.perfil(id) on delete cascade,
  concedido_em timestamptz not null default now(),
  primary key (usuario_id, perfil_id)
);

-- Permissões efetivas de um usuário, já resolvendo a herança de perfis.
create or replace view sec.vw_permissao_efetiva as
with recursive arvore as (
  select p.id as perfil_id, p.id as origem_id
  from sec.perfil p
  union all
  select a.perfil_id, pp.perfil_pai_id
  from arvore a
  join sec.perfil pp on pp.id = a.origem_id
  where pp.perfil_pai_id is not null
)
select distinct up.usuario_id, perm.codigo as permissao
from sec.usuario_perfil up
join arvore a          on a.perfil_id = up.perfil_id
join sec.perfil_permissao ppr on ppr.perfil_id = a.origem_id
join sec.permissao perm on perm.id = ppr.permissao_id;

-- ---------------------------------------------------------------------
-- Trilha de auditoria (imutável, particionada por mês)
-- ---------------------------------------------------------------------
create table if not exists audit.log (
  id             bigint generated always as identity,
  ocorrido_em    timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  acao           text not null,     -- INSERT | UPDATE | DELETE | LOGIN | LOGOUT | ...
  entidade       text,              -- schema.tabela afetada
  entidade_id    text,
  dados_antes    jsonb,
  dados_depois   jsonb,
  ip             inet,
  origem         text,              -- api | job | migration | ...
  primary key (id, ocorrido_em)
) partition by range (ocorrido_em);

-- Cria partições mensais de audit.log entre duas datas.
create or replace function audit.criar_particoes_mensais(p_inicio date, p_fim date)
returns void language plpgsql as $$
declare
  d date := date_trunc('month', p_inicio);
  nome text;
begin
  while d < p_fim loop
    nome := format('log_%s', to_char(d, 'YYYYMM'));
    execute format(
      'create table if not exists audit.%I partition of audit.log
         for values from (%L) to (%L)',
      nome, d, (d + interval '1 month')::date
    );
    d := (d + interval '1 month')::date;
  end loop;
end $$;

-- Partições para o ciclo corrente (ajustar/estender via job).
select audit.criar_particoes_mensais(date '2026-01-01', date '2027-01-01');

create index if not exists ix_audit_log_entidade on audit.log (entidade, entidade_id);
create index if not exists ix_audit_log_usuario  on audit.log (usuario_id, ocorrido_em);

-- ---------------------------------------------------------------------
-- Seed mínimo: permissões, perfis hierárquicos e um admin inicial
-- ---------------------------------------------------------------------
insert into sec.permissao (codigo, modulo, descricao) values
  ('ativo.boleta.importar',   'ativo', 'Importar boletas de aquisição'),
  ('ativo.boleta.visualizar', 'ativo', 'Consultar boletas e recebíveis'),
  ('ativo.recebivel.visualizar','ativo','Consultar estoque de direitos creditórios'),
  ('fund.fundo.gerir',        'fund',  'Cadastrar/editar fundos e classes'),
  ('fund.fundo.visualizar',   'fund',  'Consultar fundos e classes'),
  ('fechamento.executar',     'motor', 'Executar/reprocessar fechamento diário'),
  ('fechamento.visualizar',   'motor', 'Consultar cotas e PL apurados'),
  ('passivo.movimento.gerir', 'passivo','Lançar aplicações/resgates'),
  ('passivo.cotista.visualizar','passivo','Consultar posição de cotistas'),
  ('relatorio.posicao.gerar', 'relatorio','Gerar relatório de posição diária'),
  ('sec.usuario.gerir',       'sec',   'Gerir usuários e perfis'),
  ('audit.log.visualizar',    'audit', 'Consultar trilha de auditoria')
on conflict (codigo) do nothing;

insert into sec.perfil (codigo, nome, descricao, nivel) values
  ('ADMIN',      'Administrador',        'Acesso total ao sistema',                0),
  ('CONTROLLER', 'Controller',           'Controladoria: fechamento e relatórios', 1),
  ('GESTOR',     'Gestor',               'Gestão de carteira e consultas',         1),
  ('OPERADOR',   'Operador de boletas',  'Importa e consulta boletas',             2),
  ('BACKOFFICE', 'Back office',          'Passivo e cotistas',                     2),
  ('AUDITOR',    'Auditor',              'Somente leitura + trilha de auditoria',  2)
on conflict (codigo) do nothing;

-- Concessões de permissão por perfil.
with mapa(perfil, permissao) as (values
  -- ADMIN recebe tudo abaixo, explicitamente
  ('ADMIN','ativo.boleta.importar'),('ADMIN','ativo.boleta.visualizar'),
  ('ADMIN','ativo.recebivel.visualizar'),('ADMIN','fund.fundo.gerir'),
  ('ADMIN','fund.fundo.visualizar'),('ADMIN','fechamento.executar'),
  ('ADMIN','fechamento.visualizar'),('ADMIN','passivo.movimento.gerir'),
  ('ADMIN','passivo.cotista.visualizar'),('ADMIN','relatorio.posicao.gerar'),
  ('ADMIN','sec.usuario.gerir'),('ADMIN','audit.log.visualizar'),
  -- CONTROLLER
  ('CONTROLLER','fechamento.executar'),('CONTROLLER','fechamento.visualizar'),
  ('CONTROLLER','relatorio.posicao.gerar'),('CONTROLLER','ativo.recebivel.visualizar'),
  ('CONTROLLER','ativo.boleta.visualizar'),('CONTROLLER','fund.fundo.visualizar'),
  ('CONTROLLER','passivo.cotista.visualizar'),
  -- GESTOR
  ('GESTOR','fund.fundo.visualizar'),('GESTOR','ativo.recebivel.visualizar'),
  ('GESTOR','ativo.boleta.visualizar'),('GESTOR','fechamento.visualizar'),
  ('GESTOR','relatorio.posicao.gerar'),
  -- OPERADOR
  ('OPERADOR','ativo.boleta.importar'),('OPERADOR','ativo.boleta.visualizar'),
  ('OPERADOR','ativo.recebivel.visualizar'),
  -- BACKOFFICE
  ('BACKOFFICE','passivo.movimento.gerir'),('BACKOFFICE','passivo.cotista.visualizar'),
  -- AUDITOR
  ('AUDITOR','audit.log.visualizar'),('AUDITOR','fechamento.visualizar'),
  ('AUDITOR','ativo.recebivel.visualizar'),('AUDITOR','passivo.cotista.visualizar')
)
insert into sec.perfil_permissao (perfil_id, permissao_id)
select pf.id, pm.id
from mapa m
join sec.perfil pf on pf.codigo = m.perfil
join sec.permissao pm on pm.codigo = m.permissao
on conflict do nothing;

-- Admin inicial. Senha DEVE ser trocada no primeiro login.
-- Hash placeholder (senha: 'trocar@123') — substituído pela aplicação.
insert into sec.usuario (email, nome, senha_hash, mfa_habilitado)
values ('admin@fidk.local', 'Administrador', crypt('trocar@123', gen_salt('bf', 12)), false)
on conflict (email) do nothing;

insert into sec.usuario_perfil (usuario_id, perfil_id)
select u.id, p.id
from sec.usuario u, sec.perfil p
where u.email = 'admin@fidk.local' and p.codigo = 'ADMIN'
on conflict do nothing;
