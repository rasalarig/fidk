"""Motor de fechamento diário.

Apura, por classe e data de referência, de forma determinística e versionada:
  - marcação na curva dos recebíveis (convenção 252 dias úteis)
  - composição do PL (ativos − PDD + caixa + a receber − a pagar − provisões)
  - despesa de administração pro-rata die
  - quantidade de cotas, valor da cota e rentabilidade do dia

Reprocessar a mesma data gera uma nova versão, preservando o histórico.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

import asyncpg

from .. import audit

CENT = Decimal("0.01")
COTA_Q = Decimal("0.000000000001")  # 12 casas
DU_ANO = Decimal(252)
PAR = Decimal("1.000000000000")     # cota inicial ao par (R$ 1,000000)

# Marcação por título + PDD por aging + agregados da classe na data D.
# PV performing = VF / (VF/VA)^(du_restante/du_total); vencido é mantido a VF.
# PDD = VF * pct_pdd(dias de atraso). "A receber" = VF dos títulos vencidos.
_MARCACAO = """
with base as (
  select dc.valor_face, dc.valor_aquisicao,
         fund.dias_uteis(dc.data_aquisicao, dc.data_vencimento) as du_total,
         fund.dias_uteis($2::date, dc.data_vencimento)          as du_rem,
         greatest(($2::date - dc.data_vencimento), 0)           as dias_atraso
  from ativo.direito_creditorio dc
  where dc.classe_id = $1
    and dc.situacao = 'ATIVO'
    and dc.data_aquisicao <= $2::date
),
marc as (
  select
    case
      when du_rem <= 0 or du_total <= 0 then valor_face
      else round(valor_face / power(valor_face / valor_aquisicao, du_rem::numeric / du_total), 2)
    end as valor_presente,
    case when dias_atraso > 0 then round(valor_face * fund.pct_pdd(dias_atraso), 2) else 0 end as pdd,
    case when dias_atraso > 0 then valor_face else 0 end as a_receber
  from base
)
select count(*) as qtd,
       coalesce(sum(valor_presente), 0) as vp,
       coalesce(sum(pdd), 0)            as pdd,
       coalesce(sum(a_receber), 0)      as a_receber
from marc
"""


async def executar(con: asyncpg.Connection, classe_id: str, data_ref: date, user: dict) -> dict:
    classe = await con.fetchrow(
        "select id, fundo_id, codigo from fund.classe where id = $1", classe_id
    )
    if classe is None:
        raise ValueError("Classe não encontrada.")
    fundo_id = classe["fundo_id"]

    param = await con.fetchrow(
        "select * from fund.parametro_vigente($1, $2::date)", classe_id, data_ref
    )
    taxa_adm_aa = Decimal(param["taxa_administracao_aa"]) if param else Decimal(0)

    marc = await con.fetchrow(_MARCACAO, classe_id, data_ref)
    vp = Decimal(marc["vp"])
    pdd = Decimal(marc["pdd"])
    a_receber = Decimal(marc["a_receber"])
    qtd_ativos = int(marc["qtd"])

    caixa = Decimal(await con.fetchval(
        "select coalesce(sum(valor), 0) from ativo.movimento_caixa "
        "where classe_id = $1 and data <= $2::date", classe_id, data_ref))

    quantidade_cotas = Decimal(await con.fetchval(
        "select coalesce(sum(case tipo when 'EMISSAO' then quantidade else -quantidade end), 0) "
        "from passivo.cota_movimento where classe_id = $1 and data <= $2::date",
        classe_id, data_ref))

    anterior = await con.fetchrow(
        "select data_referencia, valor_cota, provisao_adm_acumulada from apuracao.fechamento "
        "where classe_id = $1 and data_referencia < $2::date and status in ('PROCESSADO','SELADO') "
        "order by data_referencia desc, versao desc limit 1",
        classe_id, data_ref)
    cota_anterior = Decimal(anterior["valor_cota"]) if anterior and anterior["valor_cota"] is not None else None
    provisao_prev = Decimal(anterior["provisao_adm_acumulada"]) if anterior else Decimal(0)

    # dias úteis decorridos desde o último fechamento (1 na inauguração)
    if anterior:
        n_du = int(await con.fetchval(
            "select fund.dias_uteis($1::date, $2::date)", anterior["data_referencia"], data_ref))
    else:
        n_du = 1

    # "A receber" (títulos vencidos) é informativo — já está no estoque a valor de face.
    contas_receber = a_receber
    contas_pagar = Decimal(0)  # outros a pagar (ex.: resgates a liquidar) — futuro

    pl_bruto = (vp + caixa).quantize(CENT, ROUND_HALF_EVEN)
    # provisão de administração pro-rata die, acumulada sobre os dias úteis do período
    despesa_adm_dia = (pl_bruto * (taxa_adm_aa / Decimal(100)) / DU_ANO * Decimal(n_du)).quantize(CENT, ROUND_HALF_EVEN)
    provisao_acum = (provisao_prev + despesa_adm_dia).quantize(CENT, ROUND_HALF_EVEN)
    pl_liquido = (pl_bruto - pdd - provisao_acum).quantize(CENT, ROUND_HALF_EVEN)

    if quantidade_cotas > 0:
        valor_cota = (pl_liquido / quantidade_cotas).quantize(COTA_Q, ROUND_HALF_EVEN)
    else:
        valor_cota = None

    base_cota = cota_anterior if cota_anterior is not None else (PAR if valor_cota is not None else None)
    if valor_cota is not None and base_cota and base_cota > 0:
        rentab = (valor_cota / base_cota - 1).quantize(Decimal("0.0000000001"), ROUND_HALF_EVEN)
    else:
        rentab = None

    versao = int(await con.fetchval(
        "select coalesce(max(versao), 0) + 1 from apuracao.fechamento "
        "where classe_id = $1 and data_referencia = $2::date", classe_id, data_ref))

    row = await con.fetchrow(
        """insert into apuracao.fechamento
             (fundo_id, classe_id, data_referencia, versao, status,
              valor_presente_ativos, pdd_total, caixa, contas_receber, contas_pagar,
              pl_bruto, despesa_adm_dia, provisao_adm_acumulada, pl_liquido,
              quantidade_cotas, valor_cota, cota_anterior, rentabilidade_dia,
              qtd_ativos, criado_por)
           values ($1,$2,$3::date,$4,'PROCESSADO',
                   $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           returning *""",
        fundo_id, classe_id, data_ref, versao,
        vp, pdd, caixa, contas_receber, contas_pagar,
        pl_bruto, despesa_adm_dia, provisao_acum, pl_liquido,
        quantidade_cotas, valor_cota, cota_anterior, rentab,
        qtd_ativos, user["id"],
    )

    await audit.registrar(
        con, acao="FECHAMENTO_EXECUTADO",
        usuario_id=str(user["id"]), usuario_email=user["email"],
        entidade="apuracao.fechamento", entidade_id=str(row["id"]),
        depois={"classe_id": str(classe_id), "data": data_ref.isoformat(),
                "versao": versao, "pl_liquido": str(pl_liquido),
                "valor_cota": str(valor_cota) if valor_cota is not None else None},
    )
    return dict(row)
