-- =====================================================================
-- 005 · Passivo completo: cotistas e vínculo com a movimentação de cotas.
-- =====================================================================

create table if not exists passivo.cotista (
  id               uuid primary key default gen_random_uuid(),
  documento        text not null check (documento ~ '^[0-9]{11}$' or documento ~ '^[0-9]{14}$'),
  nome             text not null,
  tipo_investidor  text not null default 'GERAL'
                     check (tipo_investidor in ('GERAL','QUALIFICADO','PROFISSIONAL')),
  distribuidor     text,
  email            text,
  situacao         text not null default 'ATIVO' check (situacao in ('ATIVO','INATIVO')),
  criado_em        timestamptz not null default now(),
  unique (documento)
);

-- Vincula a emissão/resgate de cotas ao cotista e adiciona datas de
-- cotização/liquidação (D+n conforme regulamento).
alter table passivo.cota_movimento
  add column if not exists cotista_id     uuid references passivo.cotista(id),
  add column if not exists data_cotizacao date,
  add column if not exists data_liquidacao date,
  add column if not exists status         text not null default 'LIQUIDADO'
                                            check (status in ('SOLICITADO','COTIZADO','LIQUIDADO'));

create index if not exists ix_cota_mov_cotista on passivo.cota_movimento (cotista_id, data);
