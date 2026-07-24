"""Pipeline de ingestão de boletas de aquisição de recebíveis.

Fluxo (orientado a alto volume):
  1. Parse + validação vetorizada (Polars).
  2. COPY em lote para a staging (asyncpg copy_records_to_table).
  3. Persistência SET-BASED: upsert de cedentes/sacados e INSERT dos direitos
     creditórios via INSERT ... SELECT com ON CONFLICT (idempotência).
"""

from __future__ import annotations

import hashlib
from datetime import date

import polars as pl

from .. import audit
from ..db import pool
from ..schemas import ImportacaoResultado, RejeicaoOut
from . import validacao

# ordem das colunas no COPY para ativo.boleta_staging (após lote_id)
_STAGING_COLS = [
    "linha_numero", "identificador_externo", "fundo_cnpj", "classe_codigo",
    "data_aquisicao", "tipo_ativo", "numero_titulo", "numero_parcela",
    "total_parcelas", "cedente_documento", "cedente_nome", "sacado_documento",
    "sacado_nome", "data_emissao", "data_vencimento", "valor_face",
    "valor_aquisicao", "taxa_desconto_aa", "indexador", "percentual_indexador",
    "coobrigacao", "conta_liquidacao", "valido", "motivo_rejeicao",
]

# Insere os direitos creditórios válidos E o débito de caixa da aquisição em UMA
# única passada SQL (CTEs data-modifying). Idempotente via ON CONFLICT: reimport
# insere 0 títulos → nenhum caixa é lançado. Nada trafega para o Python.
_INSERT_DC = """
with ins as (
  insert into ativo.direito_creditorio (
    data_aquisicao, fundo_id, classe_id, lote_id, cedente_id, sacado_id,
    identificador_externo, tipo_ativo, numero_titulo, numero_parcela, total_parcelas,
    data_emissao, data_vencimento, valor_face, valor_aquisicao, taxa_desconto_aa,
    indexador, percentual_indexador, coobrigacao, conta_liquidacao)
  select
    s.data_aquisicao::date, f.id, c.id, s.lote_id, ced.id, sac.id,
    s.identificador_externo, s.tipo_ativo, s.numero_titulo,
    coalesce(nullif(s.numero_parcela, '')::smallint, 1),
    coalesce(nullif(s.total_parcelas, '')::smallint, 1),
    nullif(s.data_emissao, '')::date, s.data_vencimento::date,
    s.valor_face::numeric, s.valor_aquisicao::numeric,
    nullif(s.taxa_desconto_aa, '')::numeric,
    coalesce(nullif(s.indexador, ''), 'PRE'),
    nullif(s.percentual_indexador, '')::numeric,
    (upper(coalesce(nullif(s.coobrigacao, ''), 'N')) in ('S', 'SIM', 'TRUE', '1')),
    nullif(s.conta_liquidacao, '')
  from ativo.boleta_staging s
  join fund.fundo  f   on f.cnpj = s.fundo_cnpj
  join fund.classe c   on c.fundo_id = f.id and c.codigo = s.classe_codigo
  join ativo.cedente ced on ced.documento = s.cedente_documento
  join ativo.sacado  sac on sac.documento = s.sacado_documento
  where s.lote_id = $1 and s.valido
  on conflict (fundo_id, identificador_externo, data_aquisicao) do nothing
  returning fundo_id, classe_id, data_aquisicao, valor_aquisicao
),
caixa as (
  insert into ativo.movimento_caixa (fundo_id, classe_id, data, tipo, valor, descricao, lote_id)
  select fundo_id, classe_id, data_aquisicao, 'AQUISICAO_DC',
         -sum(valor_aquisicao), 'Aquisição de recebíveis (lote)', $1
  from ins group by fundo_id, classe_id, data_aquisicao
  returning 1
)
select count(*) from ins
"""


async def importar_boleta(nome: str, conteudo: bytes, user: dict) -> ImportacaoResultado:
    df = validacao.ler_arquivo(nome, conteudo)  # pode levantar ValueError -> 400 no router
    arquivo_hash = hashlib.sha256(conteudo).hexdigest()

    async with pool().acquire() as con:
        # membership para validação (fundos ativos e chaves fundo|classe)
        fundos = [r["cnpj"] for r in await con.fetch(
            "select cnpj from fund.fundo where situacao = 'ATIVO'")]
        classes = [r["k"] for r in await con.fetch(
            "select f.cnpj || '|' || c.codigo as k "
            "from fund.classe c join fund.fundo f on f.id = c.fundo_id")]

        df = validacao.validar(df, fundos, classes)

        total = df.height
        validos = int(df.get_column("valido").sum() or 0)
        rejeitadas = total - validos

        # data_referencia e fundo do lote, se uniformes entre os válidos
        val_df = df.filter(pl.col("valido"))
        datas = val_df.select("data_aquisicao").unique().to_series().to_list()
        cnpjs = val_df.select("fundo_cnpj").unique().to_series().to_list()
        # data_referencia é parâmetro tipado (date) — asyncpg exige objeto date, não str
        data_ref = date.fromisoformat(datas[0]) if len(datas) == 1 else None
        cnpj_lote = cnpjs[0] if len(cnpjs) == 1 else None

        async with con.transaction():
            fundo_id = None
            if cnpj_lote:
                fundo_id = await con.fetchval(
                    "select id from fund.fundo where cnpj = $1", cnpj_lote)

            lote_id = await con.fetchval(
                """insert into ativo.lote_importacao
                     (fundo_id, arquivo_nome, arquivo_hash, data_referencia, status,
                      linhas_total, importado_por)
                   values ($1, $2, $3, $4::date, 'VALIDANDO', $5, $6)
                   returning id""",
                fundo_id, nome, arquivo_hash, data_ref, total, user["id"],
            )

            # COPY em lote para a staging
            registros = [
                (lote_id, *linha)
                for linha in df.select(_STAGING_COLS).rows()
            ]
            await con.copy_records_to_table(
                "boleta_staging",
                schema_name="ativo",
                columns=["lote_id", *_STAGING_COLS],
                records=registros,
            )

            # upsert de contrapartes (set-based, a partir dos válidos na staging)
            await con.execute(
                """insert into ativo.cedente (documento, nome)
                   select distinct cedente_documento, cedente_nome
                   from ativo.boleta_staging where lote_id = $1 and valido
                   on conflict (documento) do nothing""", lote_id)
            await con.execute(
                """insert into ativo.sacado (documento, nome)
                   select distinct sacado_documento, sacado_nome
                   from ativo.boleta_staging where lote_id = $1 and valido
                   on conflict (documento) do nothing""", lote_id)

            inseridos = await con.fetchval(_INSERT_DC, lote_id)

            await con.execute(
                """update ativo.lote_importacao
                     set status = 'PROCESSADO', linhas_aceitas = $2,
                         linhas_rejeitadas = $3, concluido_em = now()
                   where id = $1""",
                lote_id, validos, rejeitadas,
            )
            await audit.registrar(
                con,
                acao="BOLETA_IMPORTADA",
                usuario_id=str(user["id"]),
                usuario_email=user["email"],
                entidade="ativo.lote_importacao",
                entidade_id=str(lote_id),
                depois={
                    "arquivo": nome, "total": total, "aceitas": validos,
                    "rejeitadas": rejeitadas, "inseridos": inseridos,
                },
            )

        amostra = [
            RejeicaoOut(linha=int(r[0]), motivo=r[1])
            for r in df.filter(pl.col("valido").not_())
                       .select(["linha_numero", "motivo_rejeicao"]).head(20).rows()
        ]

    return ImportacaoResultado(
        lote_id=str(lote_id),
        arquivo=nome,
        status="PROCESSADO",
        linhas_total=total,
        linhas_aceitas=validos,
        linhas_rejeitadas=rejeitadas,
        registros_inseridos=inseridos,
        duplicados_ignorados=validos - inseridos,
        amostra_rejeicoes=amostra,
    )
