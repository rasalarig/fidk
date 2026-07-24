-- =====================================================================
-- 006 · PDD por faixa de atraso (base CMN 2682) e apoio a eventos.
-- =====================================================================

-- Faixas de provisão por dias de atraso (parametrizável — regra é dado).
create table if not exists fund.faixa_pdd (
  dias_atraso_min  integer primary key,
  percentual       numeric(6,4) not null,   -- fração (0.01 = 1%)
  rating           text
);

insert into fund.faixa_pdd (dias_atraso_min, percentual, rating) values
  (15,  0.0100, 'B'),
  (31,  0.0300, 'C'),
  (61,  0.1000, 'D'),
  (91,  0.3000, 'E'),
  (121, 0.5000, 'F'),
  (151, 0.7000, 'G'),
  (181, 1.0000, 'H')
on conflict (dias_atraso_min) do nothing;

-- Percentual de PDD para uma quantidade de dias de atraso.
create or replace function fund.pct_pdd(dias_atraso integer)
returns numeric language sql stable as $$
  select coalesce(
    (select percentual from fund.faixa_pdd
      where dias_atraso_min <= dias_atraso
      order by dias_atraso_min desc limit 1),
    0)
$$;
