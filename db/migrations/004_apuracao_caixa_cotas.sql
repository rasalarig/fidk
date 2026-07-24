-- =====================================================================
-- 004 · Motor de fechamento: dias úteis (252), caixa, emissão de cotas
-- e apuração diária (PL, valor de cota, quantidade de cotas).
-- =====================================================================

create schema if not exists passivo;
create schema if not exists apuracao;

-- ---------------------------------------------------------------------
-- Calendário de dias úteis (feriados ANBIMA / B3 nacionais)
-- ---------------------------------------------------------------------
create table if not exists fund.feriado (
  data       date primary key,
  descricao  text not null
);

insert into fund.feriado (data, descricao) values
  -- 2025
  ('2025-01-01','Confraternização'),('2025-03-03','Carnaval'),('2025-03-04','Carnaval'),
  ('2025-04-18','Sexta-feira Santa'),('2025-04-21','Tiradentes'),('2025-05-01','Dia do Trabalho'),
  ('2025-06-19','Corpus Christi'),('2025-09-07','Independência'),('2025-10-12','N. Sra. Aparecida'),
  ('2025-11-02','Finados'),('2025-11-15','Proclamação da República'),('2025-11-20','Consciência Negra'),
  ('2025-12-25','Natal'),
  -- 2026
  ('2026-01-01','Confraternização'),('2026-02-16','Carnaval'),('2026-02-17','Carnaval'),
  ('2026-04-03','Sexta-feira Santa'),('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),
  ('2026-06-04','Corpus Christi'),('2026-09-07','Independência'),('2026-10-12','N. Sra. Aparecida'),
  ('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Consciência Negra'),
  ('2026-12-25','Natal'),
  -- 2027
  ('2027-01-01','Confraternização'),('2027-02-08','Carnaval'),('2027-02-09','Carnaval'),
  ('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),
  ('2027-05-27','Corpus Christi'),('2027-09-07','Independência'),('2027-10-12','N. Sra. Aparecida'),
  ('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Consciência Negra'),
  ('2027-12-25','Natal')
on conflict (data) do nothing;

-- Conta dias úteis em (d_ini, d_fim]: exclui d_ini, inclui d_fim, pula
-- fins de semana e feriados. Retorna 0 quando d_fim <= d_ini.
create or replace function fund.dias_uteis(d_ini date, d_fim date)
returns integer language sql stable as $$
  select coalesce(count(*), 0)::int
  from generate_series(d_ini + 1, d_fim, interval '1 day') g(d)
  where extract(isodow from d) < 6
    and not exists (select 1 from fund.feriado f where f.data = g.d::date)
$$;

-- ---------------------------------------------------------------------
-- Caixa da classe (livro-razão simples de movimentos financeiros)
-- ---------------------------------------------------------------------
create table if not exists ativo.movimento_caixa (
  id          uuid primary key default gen_random_uuid(),
  fundo_id    uuid not null references fund.fundo(id),
  classe_id   uuid not null references fund.classe(id),
  data        date not null,
  tipo        text not null
                check (tipo in ('APORTE','RESGATE','AQUISICAO_DC','RECEBIMENTO_DC','TAXA','OUTRO')),
  valor       numeric(20,2) not null,   -- sinal: +entra / -sai
  descricao   text,
  lote_id     uuid references ativo.lote_importacao(id),
  criado_em   timestamptz not null default now()
);
create index if not exists ix_mov_caixa_classe on ativo.movimento_caixa (classe_id, data);

-- ---------------------------------------------------------------------
-- Emissão/resgate de cotas (primitiva mínima do passivo).
-- O cadastro completo de cotistas e a cotização D+n entram na Fase 3.
-- ---------------------------------------------------------------------
create table if not exists passivo.cota_movimento (
  id                uuid primary key default gen_random_uuid(),
  classe_id         uuid not null references fund.classe(id),
  data              date not null,
  tipo              text not null check (tipo in ('EMISSAO','RESGATE')),
  quantidade        numeric(28,12) not null check (quantidade > 0),
  valor_cota        numeric(28,12) not null,
  valor_financeiro  numeric(20,2) not null,
  cotista_documento text,
  cotista_nome      text,
  criado_em         timestamptz not null default now()
);
create index if not exists ix_cota_mov_classe on passivo.cota_movimento (classe_id, data);

-- ---------------------------------------------------------------------
-- Fechamento diário (apuração), versionado e selável.
-- ---------------------------------------------------------------------
create table if not exists apuracao.fechamento (
  id                       uuid primary key default gen_random_uuid(),
  fundo_id                 uuid not null references fund.fundo(id),
  classe_id                uuid not null references fund.classe(id),
  data_referencia          date not null,
  versao                   integer not null default 1,
  status                   text not null default 'PROCESSADO'
                             check (status in ('PROCESSADO','SELADO')),

  -- composição do PL
  valor_presente_ativos    numeric(20,2) not null default 0,
  pdd_total                numeric(20,2) not null default 0,
  caixa                    numeric(20,2) not null default 0,
  contas_receber           numeric(20,2) not null default 0,
  contas_pagar             numeric(20,2) not null default 0,
  pl_bruto                 numeric(20,2) not null default 0,
  despesa_adm_dia          numeric(20,2) not null default 0,
  provisao_adm_acumulada   numeric(20,2) not null default 0,
  pl_liquido               numeric(20,2) not null default 0,

  -- cota
  quantidade_cotas         numeric(28,12) not null default 0,
  valor_cota               numeric(28,12),
  cota_anterior            numeric(28,12),
  rentabilidade_dia        numeric(18,10),

  qtd_ativos               integer not null default 0,
  criado_por               uuid references sec.usuario(id),
  criado_em                timestamptz not null default now(),
  selado_em                timestamptz,

  unique (classe_id, data_referencia, versao)
);
create index if not exists ix_fechamento_classe_data
  on apuracao.fechamento (classe_id, data_referencia desc, versao desc);
