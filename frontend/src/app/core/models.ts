export interface Usuario {
  id: string;
  email: string;
  nome: string;
  permissoes: string[];
}

export interface Fundo {
  id: string;
  cnpj: string;
  nome: string;
  situacao: string;
}

export interface Classe {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
}

export interface Rejeicao {
  linha: number;
  motivo: string;
}

export interface Cotista {
  id: string;
  documento: string;
  nome: string;
  tipo_investidor: string;
  distribuidor?: string;
  situacao: string;
}

export interface PosicaoCotista {
  documento: string;
  nome: string;
  tipo_investidor: string;
  cotas: string;
  valor: string;
  participacao: number;
}

export interface RelatorioPosicao {
  data_referencia: string;
  fundo: { nome: string; cnpj: string };
  classe: { codigo: string; nome: string; tipo: string };
  fechamento: {
    versao: number; status: string; pl_bruto: string; pl_liquido: string;
    valor_cota: string | null; quantidade_cotas: string; rentabilidade_dia: string | null;
  };
  composicao: {
    estoque_valorizado: string; estoque_qtd_titulos: number; caixa: string; pdd: string;
    contas_receber: string; contas_pagar: string; provisao_administracao: string;
  };
  estoque: {
    numero_titulo: string; tipo: string; vencimento: string; sacado: string;
    cedente: string; valor_face: string; valor_presente: string;
  }[];
  cotistas: PosicaoCotista[];
}

export interface ImportacaoResultado {
  lote_id: string;
  arquivo: string;
  status: string;
  linhas_total: number;
  linhas_aceitas: number;
  linhas_rejeitadas: number;
  registros_inseridos: number;
  duplicados_ignorados: number;
  amostra_rejeicoes: Rejeicao[];
}

export interface Lote {
  id: string;
  arquivo_nome: string;
  data_referencia: string | null;
  status: string;
  linhas_total: number;
  linhas_aceitas: number;
  linhas_rejeitadas: number;
  iniciado_em: string;
}

export interface Fechamento {
  id: string;
  fundo_id: string;
  classe_id: string;
  data_referencia: string;
  versao: number;
  status: string;
  pl_liquido: string;
  pl_bruto?: string;
  caixa?: string;
  valor_presente_ativos?: string;
  pdd_total?: string;
  despesa_adm_dia?: string;
  provisao_adm_acumulada?: string;
  quantidade_cotas: string;
  valor_cota: string | null;
  cota_anterior?: string | null;
  rentabilidade_dia: string | null;
  qtd_ativos: number;
}
