from fastapi import APIRouter, Depends, HTTPException

from .. import audit
from ..db import pool
from ..schemas import FechamentoIn
from ..security import require_permission
from ..services import fechamento as motor

router = APIRouter(prefix="/fechamento", tags=["fechamento"])


def _serializar(row: dict) -> dict:
    """Converte Decimals/UUIDs/datas para tipos JSON amigáveis."""
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif v is not None and k not in ("versao", "qtd_ativos", "status"):
            out[k] = str(v) if not isinstance(v, (int, str)) else v
        else:
            out[k] = v
    return out


@router.post("/executar")
async def executar(body: FechamentoIn, user: dict = Depends(require_permission("fechamento.executar"))):
    """Executa (ou reprocessa em nova versão) o fechamento de uma classe numa data."""
    async with pool().acquire() as con:
        async with con.transaction():
            try:
                row = await motor.executar(con, body.classe_id, body.data_referencia, user)
            except ValueError as e:
                raise HTTPException(400, str(e))
    return _serializar(row)


@router.get("")
async def listar(
    classe_id: str | None = None,
    user: dict = Depends(require_permission("fechamento.visualizar")),
):
    q = """select id, fundo_id, classe_id, data_referencia, versao, status,
                  pl_liquido, quantidade_cotas, valor_cota, rentabilidade_dia, qtd_ativos
             from apuracao.fechamento"""
    args = []
    if classe_id:
        q += " where classe_id = $1"
        args.append(classe_id)
    q += " order by data_referencia desc, versao desc limit 200"
    async with pool().acquire() as con:
        rows = await con.fetch(q, *args)
    return [_serializar(dict(r)) for r in rows]


@router.get("/{fechamento_id}")
async def obter(fechamento_id: str, user: dict = Depends(require_permission("fechamento.visualizar"))):
    async with pool().acquire() as con:
        row = await con.fetchrow("select * from apuracao.fechamento where id = $1", fechamento_id)
    if row is None:
        raise HTTPException(404, "Fechamento não encontrado.")
    return _serializar(dict(row))


@router.post("/{fechamento_id}/selar")
async def selar(fechamento_id: str, user: dict = Depends(require_permission("fechamento.executar"))):
    """Sela o fechamento: torna-o imutável. Correções exigem reprocessar em nova versão."""
    async with pool().acquire() as con:
        async with con.transaction():
            row = await con.fetchrow(
                "select id, status from apuracao.fechamento where id = $1 for update", fechamento_id
            )
            if row is None:
                raise HTTPException(404, "Fechamento não encontrado.")
            if row["status"] == "SELADO":
                raise HTTPException(409, "Fechamento já está selado.")
            await con.execute(
                "update apuracao.fechamento set status = 'SELADO', selado_em = now() where id = $1",
                fechamento_id,
            )
            await audit.registrar(
                con, acao="FECHAMENTO_SELADO", usuario_id=str(user["id"]),
                usuario_email=user["email"], entidade="apuracao.fechamento",
                entidade_id=str(fechamento_id),
            )
    return {"id": fechamento_id, "status": "SELADO"}
