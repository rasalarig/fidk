-- =====================================================================
-- 002 · Estrutura de fundos sob a CVM 175: Fundo → Classe → Subclasse
-- Parâmetros de negócio (taxas, cotização, tributação) versionados por vigência.
-- =====================================================================

create schema if not exists fund;

-- ---------------------------------------------------------------------
-- Fundo (o FIDC)
-- ---------------------------------------------------------------------
create table if not exists fund.fundo (
  id             uuid primary key default gen_random_uuid(),
  cnpj           text unique not null check (cnpj ~ '^[0-9]{14}$'),
  nome           text not null,
  administrador  text,
  gestor         text,
  custodiante    text,
  data_inicio    date,
  situacao       text not null default 'ATIVO'
                   check (situacao in ('EM_ESTRUTURACAO','ATIVO','ENCERRADO')),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Classe de cotas — cada classe tem PL, cota e cotistas próprios (CVM 175)
-- ---------------------------------------------------------------------
create table if not exists fund.classe (
  id             uuid primary key default gen_random_uuid(),
  fundo_id       uuid not null references fund.fundo(id) on delete restrict,
  codigo         text not null,      -- ex.: 'SENIOR', 'MEZANINO', 'SUBORDINADA'
  nome           text not null,
  tipo           text not null default 'SENIOR'
                   check (tipo in ('SENIOR','MEZANINO','SUBORDINADA')),
  subordinacao_ordem smallint not null default 0,  -- cascata de subordinação
  moeda          text not null default 'BRL',
  situacao       text not null default 'ATIVA'
                   check (situacao in ('ATIVA','ENCERRADA')),
  criado_em      timestamptz not null default now(),
  unique (fundo_id, codigo)
);

-- ---------------------------------------------------------------------
-- Subclasse — segmentação dentro da classe (CVM 175)
-- ---------------------------------------------------------------------
create table if not exists fund.subclasse (
  id         uuid primary key default gen_random_uuid(),
  classe_id  uuid not null references fund.classe(id) on delete cascade,
  codigo     text not null,
  nome       text not null,
  criado_em  timestamptz not null default now(),
  unique (classe_id, codigo)
);

-- ---------------------------------------------------------------------
-- Parâmetros da classe, VERSIONADOS por vigência.
-- Regra de negócio é dado: nada de taxa/prazo/tributação em código.
-- ---------------------------------------------------------------------
create table if not exists fund.parametro_classe (
  id                     uuid primary key default gen_random_uuid(),
  classe_id              uuid not null references fund.classe(id) on delete cascade,
  vigencia_inicio        date not null,
  vigencia_fim           date,                 -- null = vigente

  -- Taxas (% a.a., base pro-rata die 252)
  taxa_administracao_aa  numeric(9,6) not null default 0,
  taxa_gestao_aa         numeric(9,6) not null default 0,
  taxa_performance_pct   numeric(9,6) not null default 0,
  benchmark_performance  text,                 -- ex.: 'CDI', 'IPCA+6'

  -- Cotização (dias úteis a partir da solicitação)
  prazo_cotizacao_aplicacao smallint not null default 0,   -- D+0
  prazo_cotizacao_resgate   smallint not null default 0,
  prazo_liquidacao_resgate  smallint not null default 0,
  tipo_cota                 text not null default 'FECHAMENTO'
                              check (tipo_cota in ('ABERTURA','FECHAMENTO')),

  -- Tributação (parametrizável — come-cotas isento p/ FIDC entidade de investimento)
  come_cotas             boolean not null default false,
  regra_tributaria       jsonb not null default '{}'::jsonb,

  criado_em              timestamptz not null default now(),

  -- Não pode haver duas vigências abertas para a mesma classe
  constraint uq_param_classe_vigencia unique (classe_id, vigencia_inicio)
);

create index if not exists ix_parametro_classe_vigente
  on fund.parametro_classe (classe_id, vigencia_inicio desc);

-- ---------------------------------------------------------------------
-- Contas bancárias / de liquidação do fundo
-- ---------------------------------------------------------------------
create table if not exists fund.conta (
  id           uuid primary key default gen_random_uuid(),
  fundo_id     uuid not null references fund.fundo(id) on delete cascade,
  codigo       text not null,       -- referenciado por 'conta_liquidacao' na boleta
  descricao    text,
  banco        text,
  agencia      text,
  numero       text,
  tipo         text not null default 'LIQUIDACAO'
                 check (tipo in ('LIQUIDACAO','MOVIMENTO','APLICACAO_AUTOMATICA')),
  ativa        boolean not null default true,
  criado_em    timestamptz not null default now(),
  unique (fundo_id, codigo)
);

-- Parâmetro vigente de uma classe em uma data de referência.
create or replace function fund.parametro_vigente(p_classe_id uuid, p_data date)
returns fund.parametro_classe language sql stable as $$
  select *
  from fund.parametro_classe
  where classe_id = p_classe_id
    and vigencia_inicio <= p_data
    and (vigencia_fim is null or vigencia_fim >= p_data)
  order by vigencia_inicio desc
  limit 1
$$;
