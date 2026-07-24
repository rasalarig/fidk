-- =====================================================================
-- 003 · Ativo — direitos creditórios (recebíveis)
-- Núcleo de alto volume: ingestão em lote, staging, direito creditório
-- particionado por mês e trilha de eventos por título.
-- =====================================================================

create schema if not exists ativo;

-- ---------------------------------------------------------------------
-- Contrapartes: cedente (vende o recebível) e sacado (deve o título)
-- ---------------------------------------------------------------------
create table if not exists ativo.cedente (
  id           uuid primary key default gen_random_uuid(),
  documento    text not null check (documento ~ '^[0-9]{11}$' or documento ~ '^[0-9]{14}$'),
  nome         text not null,
  criado_em    timestamptz not null default now(),
  unique (documento)
);

create table if not exists ativo.sacado (
  id           uuid primary key default gen_random_uuid(),
  documento    text not null check (documento ~ '^[0-9]{11}$' or documento ~ '^[0-9]{14}$'),
  nome         text not null,
  criado_em    timestamptz not null default now(),
  unique (documento)
);

-- ---------------------------------------------------------------------
-- Lote de importação — cabeçalho de cada arquivo de boleta processado
-- ---------------------------------------------------------------------
create table if not exists ativo.lote_importacao (
  id                uuid primary key default gen_random_uuid(),
  fundo_id          uuid references fund.fundo(id),
  arquivo_nome      text not null,
  arquivo_hash      text not null,          -- sha256 do conteúdo (evita reprocesso cego)
  data_referencia   date,
  status            text not null default 'RECEBIDO'
                      check (status in ('RECEBIDO','VALIDANDO','PROCESSADO','FALHA')),
  linhas_total      integer not null default 0,
  linhas_aceitas    integer not null default 0,
  linhas_rejeitadas integer not null default 0,
  importado_por     uuid references sec.usuario(id),
  iniciado_em       timestamptz not null default now(),
  concluido_em      timestamptz
);

create index if not exists ix_lote_arquivo_hash on ativo.lote_importacao (arquivo_hash);

-- ---------------------------------------------------------------------
-- Staging — destino do COPY bruto, sem tipagem forte, para validação
-- vetorizada. UNLOGGED: rápido e descartável (é só área de trabalho).
-- ---------------------------------------------------------------------
create unlogged table if not exists ativo.boleta_staging (
  lote_id               uuid not null references ativo.lote_importacao(id) on delete cascade,
  linha_numero          integer not null,
  identificador_externo text,
  fundo_cnpj            text,
  classe_codigo         text,
  data_aquisicao        text,
  tipo_ativo            text,
  numero_titulo         text,
  numero_parcela        text,
  total_parcelas        text,
  cedente_documento     text,
  cedente_nome          text,
  sacado_documento      text,
  sacado_nome           text,
  data_emissao          text,
  data_vencimento       text,
  valor_face            text,
  valor_aquisicao       text,
  taxa_desconto_aa      text,
  indexador             text,
  percentual_indexador  text,
  coobrigacao           text,
  conta_liquidacao      text,
  -- resultado da validação
  valido                boolean,
  motivo_rejeicao       text
);

create index if not exists ix_staging_lote on ativo.boleta_staging (lote_id);

-- ---------------------------------------------------------------------
-- Direito creditório — o título individual. PARTICIONADO por mês da
-- data de aquisição (RANGE). Chave de idempotência inclui a partição.
-- ---------------------------------------------------------------------
create table if not exists ativo.direito_creditorio (
  id                    uuid not null default gen_random_uuid(),
  data_aquisicao        date not null,               -- chave de particionamento
  fundo_id              uuid not null references fund.fundo(id),
  classe_id             uuid not null references fund.classe(id),
  lote_id               uuid references ativo.lote_importacao(id),
  cedente_id            uuid not null references ativo.cedente(id),
  sacado_id             uuid not null references ativo.sacado(id),

  identificador_externo text not null,
  tipo_ativo            text not null
                          check (tipo_ativo in
                            ('DUPLICATA','CCB','CARTAO','CHEQUE','NOTA_PROMISSORIA','CONTRATO')),
  numero_titulo         text not null,
  numero_parcela        smallint not null default 1,
  total_parcelas        smallint not null default 1,

  data_emissao          date,
  data_vencimento       date not null,
  valor_face            numeric(20,2) not null check (valor_face > 0),
  valor_aquisicao       numeric(20,2) not null check (valor_aquisicao > 0),
  taxa_desconto_aa      numeric(12,6),
  indexador             text not null default 'PRE'
                          check (indexador in ('PRE','CDI','IPCA','IGPM','SELIC')),
  percentual_indexador  numeric(9,4),
  coobrigacao           boolean not null default false,
  conta_liquidacao      text,

  -- estado do título ao longo da vida
  situacao              text not null default 'ATIVO'
                          check (situacao in ('ATIVO','LIQUIDADO','VENCIDO','RECOMPRADO','BAIXADO')),
  valor_presente        numeric(20,2),              -- marcação na curva (atualizado no fechamento)
  pdd                   numeric(20,2) not null default 0,  -- provisão p/ devedores duvidosos

  criado_em             timestamptz not null default now(),

  primary key (id, data_aquisicao),
  check (valor_aquisicao <= valor_face),
  check (data_vencimento >= data_aquisicao)
) partition by range (data_aquisicao);

-- Idempotência da ingestão (a chave inclui a coluna de partição).
create unique index if not exists uq_dc_idempotencia
  on ativo.direito_creditorio (fundo_id, identificador_externo, data_aquisicao);

-- Índices de consulta operacional.
create index if not exists ix_dc_fundo_venc  on ativo.direito_creditorio (fundo_id, data_vencimento);
create index if not exists ix_dc_situacao    on ativo.direito_creditorio (fundo_id, situacao);
create index if not exists ix_dc_sacado      on ativo.direito_creditorio (sacado_id);
create index if not exists ix_dc_cedente     on ativo.direito_creditorio (cedente_id);

-- Cria partições mensais de direito_creditorio entre duas datas.
create or replace function ativo.criar_particoes_dc(p_inicio date, p_fim date)
returns void language plpgsql as $$
declare
  d date := date_trunc('month', p_inicio);
  nome text;
begin
  while d < p_fim loop
    nome := format('direito_creditorio_%s', to_char(d, 'YYYYMM'));
    execute format(
      'create table if not exists ativo.%I partition of ativo.direito_creditorio
         for values from (%L) to (%L)',
      nome, d, (d + interval '1 month')::date
    );
    d := (d + interval '1 month')::date;
  end loop;
end $$;

select ativo.criar_particoes_dc(date '2026-01-01', date '2027-01-01');

-- ---------------------------------------------------------------------
-- Eventos do direito creditório (pagamento, atraso, recompra, baixa).
-- Imutável e particionado por mês do evento.
-- ---------------------------------------------------------------------
create table if not exists ativo.evento_direito_creditorio (
  id                uuid not null default gen_random_uuid(),
  data_evento       date not null,                 -- chave de particionamento
  direito_id        uuid not null,
  direito_aquisicao date not null,                 -- p/ referenciar a PK composta do título
  tipo              text not null
                      check (tipo in ('PAGAMENTO','PAGAMENTO_PARCIAL','ATRASO','RECOMPRA','BAIXA','AJUSTE')),
  valor             numeric(20,2),
  observacao        text,
  lote_id           uuid references ativo.lote_importacao(id),
  criado_em         timestamptz not null default now(),
  primary key (id, data_evento),
  foreign key (direito_id, direito_aquisicao)
    references ativo.direito_creditorio (id, data_aquisicao)
) partition by range (data_evento);

create index if not exists ix_evento_dc_direito
  on ativo.evento_direito_creditorio (direito_id, data_evento);

create or replace function ativo.criar_particoes_evento(p_inicio date, p_fim date)
returns void language plpgsql as $$
declare
  d date := date_trunc('month', p_inicio);
  nome text;
begin
  while d < p_fim loop
    nome := format('evento_direito_creditorio_%s', to_char(d, 'YYYYMM'));
    execute format(
      'create table if not exists ativo.%I partition of ativo.evento_direito_creditorio
         for values from (%L) to (%L)',
      nome, d, (d + interval '1 month')::date
    );
    d := (d + interval '1 month')::date;
  end loop;
end $$;

select ativo.criar_particoes_evento(date '2026-01-01', date '2027-01-01');
