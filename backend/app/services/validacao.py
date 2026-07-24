"""Validação vetorizada das boletas com Polars.

Todo o arquivo é avaliado de uma vez (sem laço linha-a-linha). Linhas inválidas
recebem `valido = False` e um `motivo_rejeicao`, sem derrubar o restante do lote.
"""

from __future__ import annotations

import io

import polars as pl

COLUNAS = [
    "identificador_externo", "fundo_cnpj", "classe_codigo", "data_aquisicao",
    "tipo_ativo", "numero_titulo", "numero_parcela", "total_parcelas",
    "cedente_documento", "cedente_nome", "sacado_documento", "sacado_nome",
    "data_emissao", "data_vencimento", "valor_face", "valor_aquisicao",
    "taxa_desconto_aa", "indexador", "percentual_indexador", "coobrigacao",
    "conta_liquidacao",
]

TIPOS_ATIVO = ["DUPLICATA", "CCB", "CARTAO", "CHEQUE", "NOTA_PROMISSORIA", "CONTRATO"]
INDEXADORES = ["PRE", "CDI", "IPCA", "IGPM", "SELIC"]


def ler_arquivo(nome: str, conteudo: bytes) -> pl.DataFrame:
    """Lê CSV (;) ou XLSX para um DataFrame 100% textual, com colunas normalizadas."""
    if nome.lower().endswith(".xlsx"):
        df = pl.read_excel(io.BytesIO(conteudo))
        df = df.select(pl.all().cast(pl.Utf8))
    else:
        df = pl.read_csv(
            io.BytesIO(conteudo),
            separator=";",
            infer_schema_length=0,        # todas as colunas como texto
            truncate_ragged_lines=True,
            quote_char='"',
        )

    faltando = [c for c in COLUNAS if c not in df.columns]
    if faltando:
        raise ValueError(f"Colunas obrigatórias ausentes no arquivo: {', '.join(faltando)}")

    # normaliza: mantém só as colunas esperadas, tira espaços e trata nulos
    df = df.select([pl.col(c) for c in COLUNAS])
    df = df.with_columns([pl.col(c).fill_null("").str.strip_chars() for c in COLUNAS])

    # documentos: só dígitos
    for c in ("fundo_cnpj", "cedente_documento", "sacado_documento"):
        df = df.with_columns(pl.col(c).str.replace_all(r"\D", "").alias(c))

    # inteiros opcionais: só dígitos (evita erro de cast no INSERT)
    for c in ("numero_parcela", "total_parcelas"):
        df = df.with_columns(pl.col(c).str.replace_all(r"\D", "").alias(c))

    df = df.with_columns(pl.col("indexador").str.to_uppercase())
    df = df.with_row_index("linha_numero", offset=2)  # +2: pula o cabeçalho (linha 1)
    return df


def _num(col: str) -> pl.Expr:
    return pl.col(col).cast(pl.Float64, strict=False)


def _data(col: str) -> pl.Expr:
    return pl.col(col).str.strptime(pl.Date, "%Y-%m-%d", strict=False)


def validar(df: pl.DataFrame, fundos_ativos: list[str], classe_keys: list[str]) -> pl.DataFrame:
    """Retorna o df com colunas `valido` (bool) e `motivo_rejeicao` (str|None)."""
    vf, va = _num("valor_face"), _num("valor_aquisicao")
    da, dv = _data("data_aquisicao"), _data("data_vencimento")
    doc_ok = pl.col("cedente_documento").str.len_chars().is_in([11, 14])
    doc_sac_ok = pl.col("sacado_documento").str.len_chars().is_in([11, 14])
    chave_classe = pl.col("fundo_cnpj") + pl.lit("|") + pl.col("classe_codigo")

    # duplicidade dentro do arquivo: mantém a 1ª ocorrência, rejeita as demais
    dup_extra = pl.col("identificador_externo").is_duplicated() & ~pl.col(
        "identificador_externo"
    ).is_first_distinct()

    # a 1ª regra que falha define o motivo (ordem importa)
    motivo = (
        pl.when(pl.col("identificador_externo") == "").then(pl.lit("identificador_externo ausente"))
        .when(pl.col("fundo_cnpj").str.len_chars() != 14).then(pl.lit("fundo_cnpj inválido"))
        .when(~pl.col("fundo_cnpj").is_in(fundos_ativos)).then(pl.lit("fundo não encontrado ou inativo"))
        .when(pl.col("classe_codigo") == "").then(pl.lit("classe_codigo ausente"))
        .when(~chave_classe.is_in(classe_keys)).then(pl.lit("classe não pertence ao fundo"))
        .when(da.is_null()).then(pl.lit("data_aquisicao inválida"))
        .when(~pl.col("tipo_ativo").is_in(TIPOS_ATIVO)).then(pl.lit("tipo_ativo inválido"))
        .when(pl.col("numero_titulo") == "").then(pl.lit("numero_titulo ausente"))
        .when(~doc_ok).then(pl.lit("cedente_documento inválido"))
        .when(pl.col("cedente_nome") == "").then(pl.lit("cedente_nome ausente"))
        .when(~doc_sac_ok).then(pl.lit("sacado_documento inválido"))
        .when(pl.col("sacado_nome") == "").then(pl.lit("sacado_nome ausente"))
        .when(dv.is_null()).then(pl.lit("data_vencimento inválida"))
        .when(vf.is_null() | (vf <= 0)).then(pl.lit("valor_face inválido"))
        .when(va.is_null() | (va <= 0)).then(pl.lit("valor_aquisicao inválido"))
        .when(va > vf).then(pl.lit("valor_aquisicao maior que valor_face"))
        .when(dv < da).then(pl.lit("data_vencimento anterior à data_aquisicao"))
        .when((pl.col("indexador") != "") & ~pl.col("indexador").is_in(INDEXADORES))
            .then(pl.lit("indexador inválido"))
        .when(dup_extra).then(pl.lit("identificador_externo duplicado no arquivo"))
        .otherwise(None)
    )

    df = df.with_columns(motivo.alias("motivo_rejeicao"))
    df = df.with_columns(pl.col("motivo_rejeicao").is_null().alias("valido"))

    # sanitiza opcionais para não quebrar o cast no INSERT set-based
    for c in ("taxa_desconto_aa", "percentual_indexador"):
        limpo = pl.col(c).cast(pl.Float64, strict=False)
        df = df.with_columns(
            pl.when(limpo.is_null()).then(pl.lit("")).otherwise(pl.col(c)).alias(c)
        )
    limpo_emissao = pl.col("data_emissao").str.strptime(pl.Date, "%Y-%m-%d", strict=False)
    df = df.with_columns(
        pl.when(limpo_emissao.is_null()).then(pl.lit("")).otherwise(pl.col("data_emissao")).alias("data_emissao")
    )
    return df
