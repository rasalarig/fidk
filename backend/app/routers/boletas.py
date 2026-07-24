from fastapi import APIRouter, Depends, HTTPException, UploadFile

from ..db import pool
from ..schemas import ImportacaoResultado
from ..security import require_permission
from ..services import ingestao

router = APIRouter(prefix="/boletas", tags=["boletas"])


@router.post("/importar", response_model=ImportacaoResultado)
async def importar(
    file: UploadFile,
    user: dict = Depends(require_permission("ativo.boleta.importar")),
):
    """Importa um arquivo de boletas de aquisição (CSV `;` ou XLSX)."""
    conteudo = await file.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")
    try:
        return await ingestao.importar_boleta(file.filename or "boleta", conteudo, user)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/lotes")
async def listar_lotes(user: dict = Depends(require_permission("ativo.boleta.visualizar"))):
    async with pool().acquire() as con:
        rows = await con.fetch(
            """select id, arquivo_nome, data_referencia, status,
                      linhas_total, linhas_aceitas, linhas_rejeitadas, iniciado_em
               from ativo.lote_importacao order by iniciado_em desc limit 100"""
        )
    return [dict(r) for r in rows]


@router.get("/lotes/{lote_id}/rejeicoes")
async def rejeicoes(
    lote_id: str, user: dict = Depends(require_permission("ativo.boleta.visualizar"))
):
    async with pool().acquire() as con:
        rows = await con.fetch(
            """select linha_numero, identificador_externo, motivo_rejeicao
               from ativo.boleta_staging
               where lote_id = $1 and not valido order by linha_numero""",
            lote_id,
        )
    return [dict(r) for r in rows]
