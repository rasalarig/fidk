from fastapi import APIRouter, Depends, HTTPException

from ..db import pool
from ..security import require_permission
from ..services import relatorio as svc

router = APIRouter(prefix="/relatorio", tags=["relatorio"])


@router.get("/posicao")
async def posicao(
    classe_id: str, data: str, user: dict = Depends(require_permission("relatorio.posicao.gerar"))
):
    """Relatório de posição diária consolidado de uma classe numa data."""
    async with pool().acquire() as con:
        try:
            return await svc.posicao_diaria(con, classe_id, data)
        except ValueError as e:
            raise HTTPException(400, str(e))
