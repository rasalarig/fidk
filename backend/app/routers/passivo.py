from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from .. import audit
from ..db import pool
from ..schemas import AplicacaoIn, AporteIn, CotistaIn, ResgateIn
from ..security import require_permission

router = APIRouter(prefix="/passivo", tags=["passivo"])

PAR = Decimal("1.000000000000")
COTA_Q = Decimal("0.000000000001")
CENT = Decimal("0.01")


async def _cota_aplicavel(con: asyncpg.Connection, classe_id: str, data) -> Decimal:
    """Valor de cota vigente para conversão: último fechamento <= data, senão o par."""
    v = await con.fetchval(
        "select valor_cota from apuracao.fechamento "
        "where classe_id = $1 and data_referencia <= $2::date and valor_cota is not null "
        "order by data_referencia desc, versao desc limit 1",
        classe_id, data,
    )
    return Decimal(v) if v is not None else PAR


async def _saldo_cotas(con: asyncpg.Connection, classe_id: str, cotista_id: str, data) -> Decimal:
    v = await con.fetchval(
        "select coalesce(sum(case tipo when 'EMISSAO' then quantidade else -quantidade end), 0) "
        "from passivo.cota_movimento where classe_id = $1 and cotista_id = $2 and data <= $3::date",
        classe_id, cotista_id, data,
    )
    return Decimal(v)


# ---------------------------------------------------------------------
# Cotistas
# ---------------------------------------------------------------------
@router.post("/cotistas", status_code=201)
async def criar_cotista(body: CotistaIn, user: dict = Depends(require_permission("passivo.movimento.gerir"))):
    async with pool().acquire() as con:
        if await con.fetchval("select 1 from passivo.cotista where documento = $1", body.documento):
            raise HTTPException(409, "Já existe cotista com este documento.")
        row = await con.fetchrow(
            """insert into passivo.cotista (documento, nome, tipo_investidor, distribuidor, email)
               values ($1, $2, $3, $4, $5) returning id, documento, nome, tipo_investidor, situacao""",
            body.documento, body.nome, body.tipo_investidor, body.distribuidor, body.email,
        )
    return dict(row)


@router.get("/cotistas")
async def listar_cotistas(user: dict = Depends(require_permission("passivo.cotista.visualizar"))):
    async with pool().acquire() as con:
        rows = await con.fetch(
            "select id, documento, nome, tipo_investidor, distribuidor, situacao "
            "from passivo.cotista order by nome"
        )
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------
# Aplicação / Resgate
# ---------------------------------------------------------------------
@router.post("/aplicacao", status_code=201)
async def aplicacao(body: AplicacaoIn, user: dict = Depends(require_permission("passivo.movimento.gerir"))):
    async with pool().acquire() as con:
        async with con.transaction():
            classe = await con.fetchrow("select fundo_id from fund.classe where id = $1", body.classe_id)
            if classe is None:
                raise HTTPException(404, "Classe não encontrada.")
            cotista = await con.fetchrow(
                "select documento, nome from passivo.cotista where id = $1", body.cotista_id)
            if cotista is None:
                raise HTTPException(404, "Cotista não encontrado.")

            cota = await _cota_aplicavel(con, body.classe_id, body.data)
            valor = Decimal(str(body.valor))
            qtd = (valor / cota).quantize(COTA_Q, ROUND_HALF_EVEN)

            await con.execute(
                """insert into passivo.cota_movimento
                     (classe_id, data, tipo, quantidade, valor_cota, valor_financeiro,
                      cotista_id, cotista_documento, cotista_nome, data_cotizacao, status)
                   values ($1,$2::date,'EMISSAO',$3,$4,$5,$6,$7,$8,$2::date,'LIQUIDADO')""",
                body.classe_id, body.data, qtd, cota, valor, body.cotista_id,
                cotista["documento"], cotista["nome"],
            )
            await con.execute(
                """insert into ativo.movimento_caixa (fundo_id, classe_id, data, tipo, valor, descricao)
                   values ($1,$2,$3::date,'APORTE',$4,'Aplicação de cotista')""",
                classe["fundo_id"], body.classe_id, body.data, valor,
            )
            await audit.registrar(
                con, acao="APLICACAO", usuario_id=str(user["id"]), usuario_email=user["email"],
                entidade="passivo.cota_movimento", entidade_id=body.cotista_id,
                depois={"valor": str(valor), "cotas": str(qtd), "cota": str(cota)})
    return {"cotas_emitidas": str(qtd), "valor_cota_aplicada": str(cota), "valor_financeiro": str(valor)}


@router.post("/resgate", status_code=201)
async def resgate(body: ResgateIn, user: dict = Depends(require_permission("passivo.movimento.gerir"))):
    if body.quantidade is None and body.valor is None:
        raise HTTPException(400, "Informe 'quantidade' (cotas) ou 'valor' (financeiro).")
    async with pool().acquire() as con:
        async with con.transaction():
            classe = await con.fetchrow("select fundo_id from fund.classe where id = $1", body.classe_id)
            if classe is None:
                raise HTTPException(404, "Classe não encontrada.")
            cotista = await con.fetchrow(
                "select documento, nome from passivo.cotista where id = $1", body.cotista_id)
            if cotista is None:
                raise HTTPException(404, "Cotista não encontrado.")

            cota = await _cota_aplicavel(con, body.classe_id, body.data)
            if body.quantidade is not None:
                qtd = Decimal(str(body.quantidade)).quantize(COTA_Q, ROUND_HALF_EVEN)
            else:
                qtd = (Decimal(str(body.valor)) / cota).quantize(COTA_Q, ROUND_HALF_EVEN)

            saldo = await _saldo_cotas(con, body.classe_id, body.cotista_id, body.data)
            if qtd > saldo:
                raise HTTPException(400, f"Saldo insuficiente: cotista possui {saldo} cotas.")

            valor = (qtd * cota).quantize(CENT, ROUND_HALF_EVEN)
            await con.execute(
                """insert into passivo.cota_movimento
                     (classe_id, data, tipo, quantidade, valor_cota, valor_financeiro,
                      cotista_id, cotista_documento, cotista_nome, data_cotizacao, status)
                   values ($1,$2::date,'RESGATE',$3,$4,$5,$6,$7,$8,$2::date,'LIQUIDADO')""",
                body.classe_id, body.data, qtd, cota, valor, body.cotista_id,
                cotista["documento"], cotista["nome"],
            )
            await con.execute(
                """insert into ativo.movimento_caixa (fundo_id, classe_id, data, tipo, valor, descricao)
                   values ($1,$2,$3::date,'RESGATE',$4,'Resgate de cotista')""",
                classe["fundo_id"], body.classe_id, body.data, -valor,
            )
            await audit.registrar(
                con, acao="RESGATE", usuario_id=str(user["id"]), usuario_email=user["email"],
                entidade="passivo.cota_movimento", entidade_id=body.cotista_id,
                depois={"valor": str(valor), "cotas": str(qtd), "cota": str(cota)})
    return {"cotas_resgatadas": str(qtd), "valor_cota_aplicada": str(cota), "valor_financeiro": str(valor)}


@router.get("/posicao")
async def posicao(classe_id: str, data: str, user: dict = Depends(require_permission("passivo.cotista.visualizar"))):
    """Posição de cada cotista na classe até a data (cotas e valor pela cota vigente)."""
    data_d = date.fromisoformat(data)
    async with pool().acquire() as con:
        cota = await _cota_aplicavel(con, classe_id, data_d)
        rows = await con.fetch(
            """select c.id, c.documento, c.nome, c.tipo_investidor,
                      coalesce(sum(case cm.tipo when 'EMISSAO' then cm.quantidade else -cm.quantidade end), 0) as cotas
                 from passivo.cotista c
                 join passivo.cota_movimento cm
                   on cm.cotista_id = c.id and cm.classe_id = $1 and cm.data <= $2::date
                 group by c.id
                 having coalesce(sum(case cm.tipo when 'EMISSAO' then cm.quantidade else -cm.quantidade end), 0) > 0
                 order by cotas desc""",
            classe_id, data_d,
        )
    total = sum(Decimal(r["cotas"]) for r in rows) or Decimal(1)
    return {
        "valor_cota": str(cota),
        "cotistas": [
            {
                "id": str(r["id"]), "documento": r["documento"], "nome": r["nome"],
                "tipo_investidor": r["tipo_investidor"],
                "cotas": str(r["cotas"]),
                "valor": str((Decimal(r["cotas"]) * cota).quantize(CENT, ROUND_HALF_EVEN)),
                "participacao": str((Decimal(r["cotas"]) / total).quantize(Decimal("0.000001"), ROUND_HALF_EVEN)),
            }
            for r in rows
        ],
    }


# Compat: aporte simples (sem cotista) — mantido para não quebrar chamadas existentes.
@router.post("/aporte", status_code=201)
async def aporte(body: AporteIn, user: dict = Depends(require_permission("passivo.movimento.gerir"))):
    async with pool().acquire() as con:
        async with con.transaction():
            classe = await con.fetchrow("select id, fundo_id from fund.classe where id = $1", body.classe_id)
            if classe is None:
                raise HTTPException(404, "Classe não encontrada.")
            cota = await _cota_aplicavel(con, body.classe_id, body.data)
            valor = Decimal(str(body.valor))
            qtd = (valor / cota).quantize(COTA_Q, ROUND_HALF_EVEN)
            await con.execute(
                """insert into passivo.cota_movimento
                     (classe_id, data, tipo, quantidade, valor_cota, valor_financeiro,
                      cotista_documento, cotista_nome, data_cotizacao, status)
                   values ($1,$2::date,'EMISSAO',$3,$4,$5,$6,$7,$2::date,'LIQUIDADO')""",
                body.classe_id, body.data, qtd, cota, valor,
                body.cotista_documento, body.cotista_nome,
            )
            await con.execute(
                """insert into ativo.movimento_caixa (fundo_id, classe_id, data, tipo, valor, descricao)
                   values ($1,$2,$3::date,'APORTE',$4,'Aporte de cotista')""",
                classe["fundo_id"], body.classe_id, body.data, valor,
            )
    return {"cotas_emitidas": str(qtd), "valor_cota_aplicada": str(cota), "valor_financeiro": str(valor)}
