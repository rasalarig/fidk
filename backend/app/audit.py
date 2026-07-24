import json

import asyncpg


async def registrar(
    con: asyncpg.Connection,
    *,
    acao: str,
    usuario_id: str | None = None,
    usuario_email: str | None = None,
    entidade: str | None = None,
    entidade_id: str | None = None,
    antes: dict | None = None,
    depois: dict | None = None,
    ip: str | None = None,
    origem: str = "api",
) -> None:
    """Grava um evento na trilha de auditoria imutável."""
    await con.execute(
        """
        insert into audit.log
          (usuario_id, usuario_email, acao, entidade, entidade_id,
           dados_antes, dados_depois, ip, origem)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)
        """,
        usuario_id,
        usuario_email,
        acao,
        entidade,
        entidade_id,
        json.dumps(antes) if antes is not None else None,
        json.dumps(depois) if depois is not None else None,
        ip,
        origem,
    )
