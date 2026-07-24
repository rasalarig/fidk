import re

from fastapi import APIRouter, Depends, HTTPException

from ..db import pool
from ..schemas import ClasseIn, FundoIn, FundoOut
from ..security import require_permission

router = APIRouter(prefix="/fundos", tags=["fundos"])


@router.get("", response_model=list[FundoOut])
async def listar(user: dict = Depends(require_permission("fund.fundo.visualizar"))):
    async with pool().acquire() as con:
        rows = await con.fetch(
            "select id, cnpj, nome, situacao from fund.fundo order by nome"
        )
    return [FundoOut(id=str(r["id"]), cnpj=r["cnpj"], nome=r["nome"], situacao=r["situacao"]) for r in rows]


@router.post("", response_model=FundoOut, status_code=201)
async def criar(body: FundoIn, user: dict = Depends(require_permission("fund.fundo.gerir"))):
    cnpj = re.sub(r"\D", "", body.cnpj or "")
    if len(cnpj) != 14:
        raise HTTPException(400, "CNPJ inválido: informe 14 dígitos.")
    if not (body.nome or "").strip():
        raise HTTPException(400, "Informe o nome do fundo.")
    async with pool().acquire() as con:
        existe = await con.fetchval("select 1 from fund.fundo where cnpj = $1", cnpj)
        if existe:
            raise HTTPException(409, "Já existe um fundo com este CNPJ.")
        row = await con.fetchrow(
            """insert into fund.fundo (cnpj, nome, administrador, gestor, custodiante, data_inicio)
               values ($1, $2, $3, $4, $5, $6)
               returning id, cnpj, nome, situacao""",
            cnpj, body.nome.strip(), body.administrador, body.gestor, body.custodiante, body.data_inicio,
        )
    return FundoOut(id=str(row["id"]), cnpj=row["cnpj"], nome=row["nome"], situacao=row["situacao"])


@router.get("/{fundo_id}/classes")
async def listar_classes(
    fundo_id: str, user: dict = Depends(require_permission("fund.fundo.visualizar"))
):
    async with pool().acquire() as con:
        rows = await con.fetch(
            "select id, codigo, nome, tipo from fund.classe where fundo_id = $1 order by codigo",
            fundo_id,
        )
    return [dict(r) for r in rows]


@router.post("/{fundo_id}/classes", status_code=201)
async def criar_classe(
    fundo_id: str, body: ClasseIn, user: dict = Depends(require_permission("fund.fundo.gerir"))
):
    codigo = (body.codigo or "").strip().upper()
    if not codigo:
        raise HTTPException(400, "Informe o código da classe.")
    if body.tipo not in ("SENIOR", "MEZANINO", "SUBORDINADA"):
        raise HTTPException(400, "Tipo inválido (SENIOR, MEZANINO ou SUBORDINADA).")
    async with pool().acquire() as con:
        async with con.transaction():
            fundo = await con.fetchval("select 1 from fund.fundo where id = $1", fundo_id)
            if not fundo:
                raise HTTPException(404, "Fundo não encontrado.")
            if await con.fetchval(
                "select 1 from fund.classe where fundo_id = $1 and codigo = $2", fundo_id, codigo
            ):
                raise HTTPException(409, "Já existe uma classe com este código neste fundo.")
            classe_id = await con.fetchval(
                """insert into fund.classe (fundo_id, codigo, nome, tipo)
                   values ($1, $2, $3, $4) returning id""",
                fundo_id, codigo, body.nome, body.tipo,
            )
            await con.execute(
                """insert into fund.parametro_classe
                     (classe_id, vigencia_inicio, taxa_administracao_aa, taxa_gestao_aa,
                      prazo_cotizacao_aplicacao, prazo_cotizacao_resgate)
                   values ($1, $2, $3, $4, $5, $6)""",
                classe_id, body.vigencia_inicio, body.taxa_administracao_aa,
                body.taxa_gestao_aa, body.prazo_cotizacao_aplicacao, body.prazo_cotizacao_resgate,
            )
    return {"id": str(classe_id), "codigo": codigo}
