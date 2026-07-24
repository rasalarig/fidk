# FIDK — Plataforma de Controladoria e Gestão para Gestora de FIDC

Sistema de **controladoria de fundos** para uma gestora que administra **FIDCs próprios**,
onde os ativos são **direitos creditórios** (duplicatas, CCB, cartão, etc.). Cobre o ciclo
completo: importação diária de boletas, apuração de **PL / valor de cota / quantidade de cotas**,
gestão do passivo (cotistas) e relatório de posição diária por carteira.

O sistema **calcula a cota oficial** — é uma controladoria de verdade, não sombra. Isso impõe
selagem do fechamento, versionamento e conciliação obrigatória entre ativo e passivo.

> Estudo de domínio e decisões de arquitetura: ver o documento visual do projeto.
> Premissa central: **alto volume**. O ganho de performance vem de ingestão em lote (`COPY`),
> Postgres particionado e processamento vetorizado — **não** de GPU no núcleo. GPU fica reservada
> a um serviço analítico opcional (risco/PDD) no futuro.

## Stack

| Camada        | Tecnologia                                  |
|---------------|---------------------------------------------|
| Front-end     | Angular + TypeScript                        |
| API           | Python · FastAPI (assíncrono)               |
| Ingestão      | Fila de tarefas + carga em lote via `COPY`  |
| Processamento | SQL orientado a conjunto + Polars/DuckDB    |
| Banco         | PostgreSQL 16 (particionado por data/fundo) |

## Estrutura do repositório

```
fidk/
├── db/
│   └── migrations/          # Modelo de dados versionado (SQL puro, idempotente)
│       ├── 001_extensoes_auth_audit.sql
│       ├── 002_estrutura_fundo.sql
│       └── 003_ativo_recebiveis.sql
├── docs/
│   └── contrato-boleta.md   # Layout-padrão do arquivo de boleta de recebíveis
├── backend/                 # API FastAPI (auth/RBAC + ingestão de boletas)
│   ├── app/                 # config, db, security, audit, routers, services
│   ├── run.py               # runner (força SelectorEventLoop no Windows)
│   └── requirements.txt
├── frontend/                # App Angular 20 (login, dashboard, boletas, fechamento)
│   └── src/app/{core,layout,pages}
└── docker-compose.yml       # Postgres 16 local (porta 55432 no host)
```

## Como subir o banco (local)

```bash
docker compose up -d db

# aplicar as migrations em ordem
for f in db/migrations/*.sql; do
  docker compose exec -T db psql -U fidk -d fidk < "$f"
done
```

No Windows/PowerShell:

```powershell
docker compose up -d db
Get-ChildItem db\migrations\*.sql | Sort-Object Name | ForEach-Object {
  Get-Content $_.FullName -Raw | docker compose exec -T db psql -U fidk -d fidk
}
```

> **Porta 55432 (não 5432):** o compose publica o Postgres em `55432` para não
> colidir com um PostgreSQL nativo eventualmente instalado no host (Windows).

## Como rodar o backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
cp .env.example .env        # ajuste se necessário (DSN aponta p/ 55432)

# IMPORTANTE no Windows: use run.py (força o SelectorEventLoop; o
# ProactorEventLoop tem bug conhecido com o COPY do asyncpg).
.venv/Scripts/python.exe run.py
```

A API sobe em `http://127.0.0.1:8077` — docs interativas em `/docs`.

**Usuário inicial (seed):** `admin@fidk.local` / senha `trocar@123` (troque no 1º acesso).

### Fluxo já disponível (Fase 1)

| Método | Rota | Permissão | O que faz |
|--------|------|-----------|-----------|
| POST | `/auth/login` | — | Autentica (form: `username`=e-mail, `password`) → JWT |
| GET  | `/auth/me` | autenticado | Dados + permissões efetivas (herança de perfis) |
| POST | `/fundos` | `fund.fundo.gerir` | Cria fundo |
| POST | `/fundos/{id}/classes` | `fund.fundo.gerir` | Cria classe + parâmetros |
| POST | `/boletas/importar` | `ativo.boleta.importar` | Importa CSV/XLSX de recebíveis (posta caixa da aquisição) |
| GET  | `/boletas/lotes` | `ativo.boleta.visualizar` | Lista lotes importados |
| GET  | `/boletas/lotes/{id}/rejeicoes` | `ativo.boleta.visualizar` | Linhas rejeitadas + motivo |
| POST | `/passivo/cotistas` | `passivo.movimento.gerir` | Cadastra cotista |
| GET  | `/passivo/cotistas` | `passivo.cotista.visualizar` | Lista cotistas |
| POST | `/passivo/aplicacao` | `passivo.movimento.gerir` | Aplicação de cotista → emite cotas + caixa |
| POST | `/passivo/resgate` | `passivo.movimento.gerir` | Resgate → queima cotas + caixa (valida saldo) |
| GET  | `/passivo/posicao?classe_id=&data=` | `passivo.cotista.visualizar` | Posição de cotistas na data |
| POST | `/fechamento/executar` | `fechamento.executar` | Apura PL, valor de cota e quantidade (versionado) |
| GET  | `/fechamento?classe_id=` | `fechamento.visualizar` | Lista fechamentos |
| POST | `/fechamento/{id}/selar` | `fechamento.executar` | Sela o dia (imutável; correção exige nova versão) |
| GET  | `/relatorio/posicao?classe_id=&data=` | `relatorio.posicao.gerar` | **Relatório de posição diária consolidado** |

## Como rodar o front-end (Angular)

```bash
cd frontend
npm install
npx ng serve --host 0.0.0.0 --port 4288
```

Abra **http://localhost:4288** e entre com `admin@fidk.local` / `trocar@123`.

> **Portas nesta máquina:** front em **4288**, API em **8077**, Postgres em **55432** —
> escolhidas para não colidir com serviços já existentes (outro Postgres, outro app em 4200,
> proxies do Docker). O CORS da API (`backend/.env`) precisa listar a origem do front.

## Convenções do modelo de dados

- **Schemas** separam responsabilidades: `sec` (segurança), `audit` (trilha),
  `fund` (estrutura de fundo/classe), `ativo` (recebíveis).
- **Eventos são imutáveis** (boletas, direitos creditórios, movimentos). Estado consolidado
  (posições, fechamentos) é **derivado e versionado** — nunca sobrescrito silenciosamente.
- **Regra de negócio é dado**, não código: taxas, prazos de cotização e tributação vivem em
  `fund.parametro_classe`, versionados por vigência.
- **Particionamento**: tabelas volumosas particionadas por mês da data de referência, mantendo
  as consultas do dia rápidas independentemente de anos de histórico.

## Roadmap

- [x] **Fase 0** — Fundação: modelo de dados, contrato de boleta, scaffolding
- [x] **Fase 1** — Ativo: ingestão de boletas + estoque de recebíveis (auth/RBAC + pipeline)
- [x] **Fase 2** — Motor de fechamento: marcação na curva (252 d.u.), PL, valor de cota, quantidade, selagem versionada
- [x] **Front-end** — Angular 20: login/RBAC, dashboard (KPIs + gráfico de cota), importação de boletas, fechamento & cota
- [x] **Fase 3** — Passivo (cotistas, aplicações, resgates) & **relatório de posição diária** (backend + telas)
- [ ] **Fase 4** — Enriquecer ativo (eventos/aging/PDD), tributação (IR/IOF/come-cotas), MaM e escala
- [ ] **Fase 4** — Escala e serviço analítico (opcional, GPU)
