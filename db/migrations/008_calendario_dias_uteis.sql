-- =====================================================================
-- 008 · Calendário pré-computado de dias úteis (performance da marcação).
-- Em vez de contar dias úteis por título (generate_series por linha, O(dias)),
-- guardamos a contagem ACUMULADA de dias úteis por data. Assim,
--   dias_uteis(d1, d2] = du_acumulado(d2) - du_acumulado(d1)   -> O(1) por título.
-- =====================================================================

create table if not exists fund.calendario (
  data          date primary key,
  dia_util      boolean not null,
  du_acumulado  integer not null
);

insert into fund.calendario (data, dia_util, du_acumulado)
select d::date,
       du,
       (sum(case when du then 1 else 0 end) over (order by d))::int
from (
  select d,
         (extract(isodow from d) < 6
          and not exists (select 1 from fund.feriado f where f.data = d::date)) as du
  from generate_series(date '2010-01-01', date '2040-12-31', interval '1 day') g(d)
) x
on conflict (data) do nothing;

-- dias_uteis passa a usar o calendário (O(1)); mantém fallback para datas
-- fora do intervalo pré-computado.
create or replace function fund.dias_uteis(d_ini date, d_fim date)
returns integer language sql stable as $$
  select greatest(coalesce(
    (select c2.du_acumulado - c1.du_acumulado
       from fund.calendario c1, fund.calendario c2
      where c1.data = d_ini and c2.data = d_fim),
    (select count(*)::int
       from generate_series(d_ini + 1, d_fim, interval '1 day') g(d)
      where extract(isodow from d) < 6
        and not exists (select 1 from fund.feriado f where f.data = g.d::date))
  ), 0)
$$;
