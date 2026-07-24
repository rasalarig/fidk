from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from .. import audit
from ..config import settings
from ..db import pool
from ..schemas import TokenOut, UsuarioOut
from ..security import criar_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
async def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    """Autentica por e-mail (campo 'username') e senha. Aplica bloqueio por tentativas."""
    email = form.username.strip().lower()
    ip = request.client.host if request.client else None

    async with pool().acquire() as con:
        async with con.transaction():
            row = await con.fetchrow(
                """select id, email, nome, ativo, falhas_login, bloqueado_ate,
                          (senha_hash = crypt($2, senha_hash)) as senha_ok
                   from sec.usuario where email = $1""",
                email,
                form.password,
            )

            invalido = HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="E-mail ou senha inválidos.",
            )

            if row is None:
                raise invalido
            if not row["ativo"]:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Usuário inativo.")
            if row["bloqueado_ate"] is not None:
                bloqueado = await con.fetchval(
                    "select $1::timestamptz > now()", row["bloqueado_ate"]
                )
                if bloqueado:
                    raise HTTPException(
                        status.HTTP_423_LOCKED,
                        "Conta temporariamente bloqueada por tentativas de login.",
                    )

            if not row["senha_ok"]:
                falhas = row["falhas_login"] + 1
                if falhas >= settings.max_login_falhas:
                    await con.execute(
                        """update sec.usuario
                             set falhas_login = $2,
                                 bloqueado_ate = now() + ($3 || ' minutes')::interval
                           where id = $1""",
                        row["id"],
                        falhas,
                        str(settings.bloqueio_minutos),
                    )
                else:
                    await con.execute(
                        "update sec.usuario set falhas_login = $2 where id = $1",
                        row["id"],
                        falhas,
                    )
                await audit.registrar(
                    con,
                    acao="LOGIN_FALHA",
                    usuario_id=str(row["id"]),
                    usuario_email=email,
                    ip=ip,
                )
                raise invalido

            # sucesso
            await con.execute(
                """update sec.usuario
                     set falhas_login = 0, bloqueado_ate = null, ultimo_login = now()
                   where id = $1""",
                row["id"],
            )
            await audit.registrar(
                con,
                acao="LOGIN",
                usuario_id=str(row["id"]),
                usuario_email=email,
                ip=ip,
            )

    return TokenOut(access_token=criar_token(row["id"], email))


@router.get("/me", response_model=UsuarioOut)
async def me(user: dict = Depends(get_current_user)):
    async with pool().acquire() as con:
        perms = await con.fetch(
            "select permissao from sec.vw_permissao_efetiva where usuario_id = $1",
            user["id"],
        )
    return UsuarioOut(
        id=str(user["id"]),
        email=user["email"],
        nome=user["nome"],
        permissoes=[p["permissao"] for p in perms],
    )
