# =====================================================================
# FIDK — imagem única: backend FastAPI servindo a API + o app Angular.
# =====================================================================

# --- Estágio 1: build do front-end Angular ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Estágio 2: backend + estáticos ---
FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY db/ db/
# build do Angular vindo do estágio 1 (é o que o FastAPI serve)
COPY --from=frontend /app/frontend/dist/frontend/browser ./frontend/dist/frontend/browser

ENV PORT=8077
EXPOSE 8077
WORKDIR /app/backend
CMD ["python", "run.py"]
