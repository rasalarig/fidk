"""Relatório consolidado de posição diária por carteira/classe.

Reúne, para uma data, a foto completa da carteira: composição do PL (do
fechamento oficial), estoque de recebíveis valorizado, caixa, provisões e a
posição de cada cotista. Reproduzível para qualquer data já fechada.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

import asyncpg

CENT = Decimal("0.01")

_ESTOQUE = """
with base as (
  select dc.numero_titulo, dc.tipo_ativo, dc.data_vencimento,
         dc.valor_face, dc.valor_aquisicao,
         s.nome as sacado, ced.nome as cedente,
         fund.dias_uteis(dc.data_aquisicao, dc.data_vencimento) as du_total,
         fund.dias_uteis($2::date, dc.data_vencimento)          as du_rem
  from ativo.direito_creditorio dc
  join ativo.sacado  s   on s.id = dc.sacado_id
  join ativo.cedente ced on ced.id = dc.cedente_id
  where dc.classe_id = $1 and dc.situacao = 'ATIVO' and dc.data_aquisicao <= $2::date
)
select numero_titulo, tipo_ativo, data_vencimento, valor_face, sacado, cedente,
  case when du_rem <= 0 or du_total <= 0 then valor_face
       else round(valor_face / power(valor_face / valor_aquisicao, du_rem::numeric / du_total), 2)
  end as valor_presente
from base
order by valor_presente desc
"""

_COTISTAS = """
select c.documento, c.nome, c.tipo_investidor,
       coalesce(sum(case cm.tipo when 'EMISSAO' then cm.quantidade else -cm.quantidade end), 0) as cotas
from passivo.cotista c
join passivo.cota_movimento cm
  on cm.cotista_id = c.id and cm.classe_id = $1 and cm.data <= $2::date
group by c.id
having coalesce(sum(case cm.tipo when 'EMISSAO' then cm.quantidade else -cm.quantidade end), 0) > 0
order by cotas desc
"""


async def posicao_diaria(con: asyncpg.Connection, classe_id: str, data: str) -> dict:
    data = date.fromisoformat(data)  # parâmetros tipados exigem objeto date
    fech = await con.fetchrow(
        "select * from apuracao.fechamento "
        "where classe_id = $1 and data_referencia <= $2::date "
        "order by data_referencia desc, versao desc limit 1",
        classe_id, data,
    )
    if fech is None:
        raise ValueError("Nenhum fechamento apurado até a data. Execute o fechamento primeiro.")

    data_ref = fech["data_referencia"]
    classe = await con.fetchrow(
        "select c.codigo, c.nome, c.tipo, f.nome as fundo_nome, f.cnpj as fundo_cnpj "
        "from fund.classe c join fund.fundo f on f.id = c.fundo_id where c.id = $1",
        classe_id,
    )

    estoque = await con.fetch(_ESTOQUE, classe_id, data_ref)
    estoque_total = sum(Decimal(r["valor_presente"]) for r in estoque)
    cota = Decimal(fech["valor_cota"]) if fech["valor_cota"] is not None else Decimal(0)

    cotistas = await con.fetch(_COTISTAS, classe_id, data_ref)
    cotas_atribuidas = sum(Decimal(r["cotas"]) for r in cotistas)
    total_cotas = Decimal(fech["quantidade_cotas"])
    lista_cotistas = [
        {
            "documento": r["documento"], "nome": r["nome"], "tipo_investidor": r["tipo_investidor"],
            "cotas": str(r["cotas"]),
            "valor": str((Decimal(r["cotas"]) * cota).quantize(CENT, ROUND_HALF_EVEN)),
            "participacao": float((Decimal(r["cotas"]) / total_cotas)) if total_cotas > 0 else 0.0,
        }
        for r in cotistas
    ]
    residual = total_cotas - cotas_atribuidas
    if residual > Decimal("0.000001"):
        lista_cotistas.append({
            "documento": "—", "nome": "Não atribuído a cotista", "tipo_investidor": "—",
            "cotas": str(residual),
            "valor": str((residual * cota).quantize(CENT, ROUND_HALF_EVEN)),
            "participacao": float(residual / total_cotas) if total_cotas > 0 else 0.0,
        })

    return {
        "data_referencia": data_ref.isoformat(),
        "fundo": {"nome": classe["fundo_nome"], "cnpj": classe["fundo_cnpj"]},
        "classe": {"codigo": classe["codigo"], "nome": classe["nome"], "tipo": classe["tipo"]},
        "fechamento": {
            "versao": fech["versao"], "status": fech["status"],
            "pl_bruto": str(fech["pl_bruto"]), "pl_liquido": str(fech["pl_liquido"]),
            "valor_cota": str(fech["valor_cota"]) if fech["valor_cota"] is not None else None,
            "quantidade_cotas": str(fech["quantidade_cotas"]),
            "rentabilidade_dia": str(fech["rentabilidade_dia"]) if fech["rentabilidade_dia"] is not None else None,
        },
        "composicao": {
            "estoque_valorizado": str(estoque_total),
            "estoque_qtd_titulos": len(estoque),
            "caixa": str(fech["caixa"]),
            "pdd": str(fech["pdd_total"]),
            "contas_receber": str(fech["contas_receber"]),
            "contas_pagar": str(fech["contas_pagar"]),
            "provisao_administracao": str(fech["provisao_adm_acumulada"]),
        },
        "estoque": [
            {
                "numero_titulo": r["numero_titulo"], "tipo": r["tipo_ativo"],
                "vencimento": r["data_vencimento"].isoformat(),
                "sacado": r["sacado"], "cedente": r["cedente"],
                "valor_face": str(r["valor_face"]), "valor_presente": str(r["valor_presente"]),
            }
            for r in estoque[:100]
        ],
        "cotistas": lista_cotistas,
    }
