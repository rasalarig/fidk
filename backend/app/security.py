from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .config import settings
from .db import pool

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def criar_token(usuario_id: str, email: str) -> str:
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": str(usuario_id),
        "email": email,
        "iat": agora,
        "exp": agora + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_alg)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas ou expiradas.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
        usuario_id = payload.get("sub")
        if usuario_id is None:
            raise cred_exc
    except jwt.PyJWTError:
        raise cred_exc

    async with pool().acquire() as con:
        row = await con.fetchrow(
            "select id, email, nome, ativo from sec.usuario where id = $1", usuario_id
        )
    if row is None or not row["ativo"]:
        raise cred_exc
    return dict(row)


def require_permission(codigo: str):
    """Dependency que exige uma permissão efetiva (já resolvendo herança de perfis)."""

    async def checar(user: dict = Depends(get_current_user)) -> dict:
        async with pool().acquire() as con:
            tem = await con.fetchval(
                "select exists(select 1 from sec.vw_permissao_efetiva "
                "where usuario_id = $1 and permissao = $2)",
                user["id"],
                codigo,
            )
        if not tem:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado: requer a permissão '{codigo}'.",
            )
        return user

    return checar
