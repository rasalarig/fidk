from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração da aplicação — lida de variáveis de ambiente (prefixo FIDK_) ou .env."""

    database_url: str = "postgresql://fidk:fidk@localhost:5432/fidk"
    jwt_secret: str = "dev-insecure-change-me"
    jwt_alg: str = "HS256"
    jwt_expire_minutes: int = 480

    # Segurança de login
    max_login_falhas: int = 5
    bloqueio_minutos: int = 15

    # CORS (front Angular)
    cors_origins: str = "http://localhost:4200"

    model_config = SettingsConfigDict(env_prefix="FIDK_", env_file=".env", extra="ignore")

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
