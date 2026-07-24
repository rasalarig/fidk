-- =====================================================================
-- 007 · Índice na staging para inserção em lotes (progresso incremental).
-- Permite inserir os direitos creditórios por faixas de linha_numero,
-- reportando progresso ao usuário durante a importação.
-- =====================================================================

create index if not exists ix_staging_lote_linha
  on ativo.boleta_staging (lote_id, linha_numero);
