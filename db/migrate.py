"""Aplica todas as migrations (db/migrations/*.sql) no banco em FIDK_DATABASE_URL.

Uso:
    FIDK_DATABASE_URL=postgresql://user:pass@host:5432/db python db/migrate.py

As migrations são idempotentes (create if not exists / on conflict do nothing),
então rodar de novo é seguro.
"""

import asyncio
import glob
import os
import sys

import asyncpg

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def main() -> None:
    dsn = os.environ.get("FIDK_DATABASE_URL")
    if not dsn:
        print("ERRO: defina FIDK_DATABASE_URL", file=sys.stderr)
        sys.exit(1)

    kwargs: dict = {}
    if "pooler." in dsn or "pgbouncer" in dsn:
        kwargs["statement_cache_size"] = 0

    con = await asyncpg.connect(dsn, **kwargs)
    try:
        arquivos = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "migrations", "*.sql")))
        for caminho in arquivos:
            nome = os.path.basename(caminho)
            with open(caminho, encoding="utf-8") as f:
                sql = f.read()
            print(f"[migrate] aplicando {nome} ...")
            await con.execute(sql)
        print(f"[migrate] OK - {len(arquivos)} migrations aplicadas.")
    finally:
        await con.close()


if __name__ == "__main__":
    asyncio.run(main())
