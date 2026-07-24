"""Runner da API.

No Windows, força o SelectorEventLoop antes de o uvicorn criar o loop:
o ProactorEventLoop tem problemas conhecidos com operações de socket do
asyncpg (ex.: COPY em lote). Use sempre `python run.py` no Windows.
"""

import asyncio
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # noqa: E402  (import após setar a policy, de propósito)

if __name__ == "__main__":
    # Render (e outros PaaS) injetam a porta via env PORT.
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8077")),
        reload=False,
        log_level="info",
    )
