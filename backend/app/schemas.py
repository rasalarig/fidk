from datetime import date

from pydantic import BaseModel, Field


# ---------- Auth ----------
class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UsuarioOut(BaseModel):
    id: str
    email: str
    nome: str
    permissoes: list[str] = []


# ---------- Fundos ----------
class FundoIn(BaseModel):
    cnpj: str = Field(..., pattern=r"^\d{14}$")
    nome: str
    administrador: str | None = None
    gestor: str | None = None
    custodiante: str | None = None
    data_inicio: date | None = None


class ClasseIn(BaseModel):
    codigo: str
    nome: str
    tipo: str = "SENIOR"
    taxa_administracao_aa: float = 0
    taxa_gestao_aa: float = 0
    prazo_cotizacao_aplicacao: int = 0
    prazo_cotizacao_resgate: int = 0
    vigencia_inicio: date


class FundoOut(BaseModel):
    id: str
    cnpj: str
    nome: str
    situacao: str


# ---------- Ingestão de boletas ----------
class RejeicaoOut(BaseModel):
    linha: int
    motivo: str


class ImportacaoResultado(BaseModel):
    lote_id: str
    arquivo: str
    status: str
    linhas_total: int
    linhas_aceitas: int
    linhas_rejeitadas: int
    registros_inseridos: int
    duplicados_ignorados: int
    amostra_rejeicoes: list[RejeicaoOut] = []


# ---------- Passivo ----------
class AporteIn(BaseModel):
    classe_id: str
    data: date
    valor: float = Field(..., gt=0)
    cotista_documento: str | None = None
    cotista_nome: str | None = None


class CotistaIn(BaseModel):
    documento: str  # normalizado (só dígitos) e validado no handler — aceita com pontuação
    nome: str
    tipo_investidor: str = "GERAL"
    distribuidor: str | None = None
    email: str | None = None


class AplicacaoIn(BaseModel):
    classe_id: str
    cotista_id: str
    data: date
    valor: float = Field(..., gt=0)


class ResgateIn(BaseModel):
    classe_id: str
    cotista_id: str
    data: date
    quantidade: float | None = Field(default=None, gt=0)
    valor: float | None = Field(default=None, gt=0)


# ---------- Ativo (eventos) ----------
class EventoIn(BaseModel):
    fundo_id: str
    identificador_externo: str
    tipo: str  # PAGAMENTO | PAGAMENTO_PARCIAL | BAIXA | RECOMPRA | ATRASO | AJUSTE
    data: date
    valor: float | None = None
    observacao: str | None = None


# ---------- Fechamento ----------
class FechamentoIn(BaseModel):
    classe_id: str
    data_referencia: date
