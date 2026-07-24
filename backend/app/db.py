import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    kwargs: dict = {"min_size": 2, "max_size": 10, "command_timeout": 60}
    # Poolers (ex.: Supabase/pgbouncer) não convivem com prepared statements
    # em cache — desliga o cache quando o destino é um pooler.
    if "pooler." in settings.database_url or "pgbouncer" in settings.database_url:
        kwargs["statement_cache_size"] = 0
    _pool = await asyncpg.create_pool(settings.database_url, **kwargs)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Pool de conexões não inicializado.")
    return _pool
