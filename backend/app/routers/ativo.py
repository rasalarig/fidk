from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException

from .. import audit
from ..db import pool
from ..schemas import EventoIn
from ..security import require_permission

router = APIRouter(prefix="/ativo", tags=["ativo"])

# efeito de cada evento sobre a situação do título
_SITUACAO = {
    "PAGAMENTO": "LIQUIDADO",
    "BAIXA": "BAIXADO",
    "RECOMPRA": "RECOMPRADO",
}
# eventos que geram entrada de caixa (RECEBIMENTO_DC)
_ENTRA_CAIXA = {"PAGAMENTO", "RECOMPRA"}


@router.post("/eventos", status_code=201)
async def registrar_evento(body: EventoIn, user: dict = Depends(require_permission("ativo.boleta.importar"))):
    """Registra um evento do recebível (pagamento, baixa, recompra…) e atualiza sua situação."""
    async with pool().acquire() as con:
        async with con.transaction():
            titulos = await con.fetch(
                """select id, data_aquisicao, classe_id, fundo_id, valor_face, situacao
                     from ativo.direito_creditorio
                    where fundo_id = $1 and identificador_externo = $2""",
                body.fundo_id, body.identificador_externo,
            )
            if not titulos:
                raise HTTPException(404, "Direito creditório não encontrado.")
            if len(titulos) > 1:
                raise HTTPException(409, "Identificador ambíguo (mais de um título). Refine a busca.")
            t = titulos[0]

            valor = Decimal(str(body.valor)) if body.valor is not None else Decimal(t["valor_face"])

            await con.execute(
                """insert into ativo.evento_direito_creditorio
                     (data_evento, direito_id, direito_aquisicao, tipo, valor, observacao)
                   values ($1::date, $2, $3, $4, $5, $6)""",
                body.data, t["id"], t["data_aquisicao"], body.tipo, valor, body.observacao,
            )

            nova_situacao = _SITUACAO.get(body.tipo)
            if nova_situacao:
                await con.execute(
                    "update ativo.direito_creditorio set situacao = $3 "
                    "where id = $1 and data_aquisicao = $2",
                    t["id"], t["data_aquisicao"], nova_situacao,
                )
            if body.tipo in _ENTRA_CAIXA:
                await con.execute(
                    """insert into ativo.movimento_caixa
                         (fundo_id, classe_id, data, tipo, valor, descricao)
                       values ($1, $2, $3::date, 'RECEBIMENTO_DC', $4, $5)""",
                    t["fundo_id"], t["classe_id"], body.data, valor,
                    f"{body.tipo} do título {body.identificador_externo}",
                )
            await audit.registrar(
                con, acao="EVENTO_RECEBIVEL", usuario_id=str(user["id"]), usuario_email=user["email"],
                entidade="ativo.direito_creditorio", entidade_id=str(t["id"]),
                depois={"tipo": body.tipo, "valor": str(valor), "situacao": nova_situacao or t["situacao"]},
            )
    return {"identificador_externo": body.identificador_externo, "tipo": body.tipo,
            "situacao": nova_situacao or t["situacao"], "valor": str(valor)}


@router.get("/recebiveis")
async def listar_recebiveis(
    classe_id: str,
    situacao: str | None = None,
    limit: int = 200,
    user: dict = Depends(require_permission("ativo.recebivel.visualizar")),
):
    """Lista o estoque de direitos creditórios de uma classe."""
    q = """select identificador_externo, tipo_ativo, numero_titulo, data_aquisicao,
                  data_vencimento, valor_face, valor_aquisicao, situacao
             from ativo.direito_creditorio where classe_id = $1"""
    args = [classe_id]
    if situacao:
        q += " and situacao = $2"
        args.append(situacao)
    q += f" order by data_vencimento limit {int(limit)}"
    async with pool().acquire() as con:
        rows = await con.fetch(q, *args)
    return [dict(r) for r in rows]
