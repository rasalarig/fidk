import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .db import close_pool, init_pool
from .routers import ativo, auth, boletas, fechamento, fundos, passivo, relatorio

# Diretório do build do Angular (presente em produção; ausente em dev API-only).
STATIC_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist", "frontend", "browser")
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()


app = FastAPI(
    title="FIDK — Controladoria de FIDC",
    description="API de gestão de gestora de FIDC: ativo (recebíveis), passivo e cotas.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(fundos.router)
app.include_router(boletas.router)
app.include_router(ativo.router)
app.include_router(passivo.router)
app.include_router(fechamento.router)
app.include_router(relatorio.router)


@app.get("/health", tags=["infra"])
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Front-end: serve o SPA Angular (quando o build existe). As rotas de API
# acima têm precedência; este catch-all cobre os assets e o roteamento
# client-side (qualquer rota desconhecida devolve index.html).
# ---------------------------------------------------------------------
if os.path.isdir(STATIC_DIR):

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidato = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidato):
            return FileResponse(candidato)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
