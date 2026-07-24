# Deploy — Supabase + Render

O projeto sobe como **um único serviço**: o backend FastAPI serve a API **e** o
app Angular já buildado (mesma origem, sem CORS em produção). O banco é o **Supabase**.

## 1. Banco (Supabase)

A `DATABASE_URL` do Supabase tem o formato:

```
postgresql://postgres.<PROJECT_REF>:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

- A **senha** precisa ter caracteres especiais URL-encodados: `@` → `%40`, `!` → `%21`.
- Mantenha `?sslmode=require`.
- **Nunca** commite essa string — ela vive só nas variáveis de ambiente.

Aplicar/atualizar o schema (idempotente):

```bash
FIDK_DATABASE_URL="postgresql://…?sslmode=require" python db/migrate.py
```

> O schema já foi aplicado no Supabase deste projeto. Usuário inicial:
> `admin@fidk.local` / `trocar@123` (troque no primeiro acesso).

## 2. Aplicação (Render)

O repositório traz um `Dockerfile` (multi-stage: builda o Angular e empacota com o
backend) e um `render.yaml` (Blueprint).

1. No Render: **New → Blueprint** e aponte para este repositório.
2. Ele cria o Web Service `fidk` (runtime Docker).
3. Em **Environment**, defina o segredo:
   - `FIDK_DATABASE_URL` = a string do Supabase acima (com `?sslmode=require`).
   - `FIDK_JWT_SECRET` já é gerado automaticamente pelo Render.
4. Deploy. O health check é `GET /health`.

Ao abrir a URL do serviço, o Angular é servido na raiz e conversa com a API na
mesma origem.

## 3. Rodar localmente (referência)

```bash
docker compose up -d db                     # Postgres local (porta 55432)
FIDK_DATABASE_URL="postgresql://fidk:fidk@127.0.0.1:55432/fidk" python db/migrate.py
cd backend && python run.py                 # API em :8077 (serve o front se buildado)
cd frontend && npx ng serve --port 4288     # dev do front (aponta para :8077)
```
