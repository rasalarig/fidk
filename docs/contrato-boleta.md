# Contrato-padrão — Boleta de aquisição de direitos creditórios

Layout único para a importação diária de recebíveis adquiridos por um FIDC. Cada **linha** é
um direito creditório (um título). A gestora ainda não tem um layout fixo, então este é o padrão
proposto — desenhado para ser simples de gerar a partir de qualquer origem e robusto para alto volume.

## Formato do arquivo

- **Codificação:** UTF-8
- **Formatos aceitos:** CSV (separador `;`), ou Excel `.xlsx` (primeira aba)
- **Cabeçalho:** obrigatório, na primeira linha, com os nomes de coluna exatamente como abaixo
- **Decimais:** ponto como separador decimal (`1234.56`), sem separador de milhar
- **Datas:** `AAAA-MM-DD` (ISO 8601)
- **Documentos:** CPF/CNPJ apenas dígitos (sem pontuação)

## Colunas

| Coluna                  | Tipo         | Obrig. | Descrição                                                                 |
|-------------------------|--------------|:------:|---------------------------------------------------------------------------|
| `identificador_externo` | texto(80)    |  Sim   | Chave única do título na origem. Base da **idempotência** (ver abaixo).   |
| `fundo_cnpj`            | texto(14)    |  Sim   | CNPJ do FIDC adquirente (só dígitos). Deve existir em `fund.fundo`.        |
| `classe_codigo`         | texto(40)    |  Sim   | Código da classe de cotas que financia a aquisição.                       |
| `data_aquisicao`        | data         |  Sim   | Data da cessão/compra (data de referência da boleta).                     |
| `tipo_ativo`            | enum         |  Sim   | `DUPLICATA`, `CCB`, `CARTAO`, `CHEQUE`, `NOTA_PROMISSORIA`, `CONTRATO`.   |
| `numero_titulo`         | texto(60)    |  Sim   | Número do documento/título na origem.                                     |
| `numero_parcela`        | inteiro      |  Não   | Nº da parcela (default 1).                                                |
| `total_parcelas`        | inteiro      |  Não   | Total de parcelas do título (default 1).                                  |
| `cedente_documento`     | texto(14)    |  Sim   | CPF/CNPJ do cedente (quem vendeu o recebível ao fundo).                   |
| `cedente_nome`          | texto(200)   |  Sim   | Razão social / nome do cedente.                                           |
| `sacado_documento`      | texto(14)    |  Sim   | CPF/CNPJ do sacado (quem deve pagar o título).                            |
| `sacado_nome`           | texto(200)   |  Sim   | Razão social / nome do sacado.                                            |
| `data_emissao`          | data         |  Não   | Data de emissão do título.                                                |
| `data_vencimento`       | data         |  Sim   | Vencimento do título. Deve ser ≥ `data_aquisicao`.                        |
| `valor_face`            | numérico     |  Sim   | Valor nominal / de vencimento (> 0), em reais.                            |
| `valor_aquisicao`       | numérico     |  Sim   | Valor presente pago pelo fundo (> 0 e ≤ `valor_face`).                    |
| `taxa_desconto_aa`      | numérico     |  Não   | Taxa de cessão em % a.a. Se ausente, é derivada de face/aquisição/prazo.  |
| `indexador`             | enum         |  Não   | `PRE`, `CDI`, `IPCA`, `IGPM`, `SELIC` (default `PRE`).                    |
| `percentual_indexador`  | numérico     |  Não   | % do indexador (ex.: 120 para 120% do CDI).                              |
| `coobrigacao`           | S/N          |  Não   | Cedente é coobrigado pelo pagamento? (default `N`).                       |
| `conta_liquidacao`      | texto(40)    |  Não   | Identificação da conta de liquidação do fundo.                            |

## Regras de validação (na ingestão)

Validadas **em lote e de forma vetorizada** — o arquivo inteiro é avaliado; linhas inválidas são
**rejeitadas individualmente** com o motivo, sem travar o restante do lote.

1. **Campos obrigatórios** presentes e não vazios.
2. **`fundo_cnpj`** existe e o fundo está ativo; **`classe_codigo`** pertence ao fundo.
3. **`valor_face` > 0** e **`0 < valor_aquisicao ≤ valor_face`**.
4. **`data_vencimento` ≥ `data_aquisicao`**; datas em formato ISO válido.
5. **Documentos** com 11 (CPF) ou 14 (CNPJ) dígitos.
6. **`tipo_ativo` / `indexador`** dentro dos valores permitidos.
7. **Duplicidade** no próprio arquivo por `identificador_externo` → rejeita as repetidas.

## Idempotência

A chave de negócio de um título é **(`fundo_cnpj`, `identificador_externo`, `data_aquisicao`)**.

- Reimportar o mesmo arquivo **não duplica** títulos: linhas já persistidas com a mesma chave
  são identificadas e **ignoradas** (ou atualizadas, conforme a política do lote).
- Cada importação gera um **lote** (`ativo.lote_importacao`) com contadores de aceitos/rejeitados
  e um hash do arquivo, permitindo rastrear e reprocessar com segurança.

## Exemplo (CSV)

```csv
identificador_externo;fundo_cnpj;classe_codigo;data_aquisicao;tipo_ativo;numero_titulo;numero_parcela;total_parcelas;cedente_documento;cedente_nome;sacado_documento;sacado_nome;data_emissao;data_vencimento;valor_face;valor_aquisicao;taxa_desconto_aa;indexador;percentual_indexador;coobrigacao;conta_liquidacao
ACME-2026-000101;12345678000190;SENIOR;2026-07-23;DUPLICATA;NF-8842/1;1;3;98765432000121;Comercial Acme Ltda;11222333000181;Varejo Beta SA;2026-07-20;2026-08-22;10000.00;9720.50;18.500000;PRE;;S;CTA-LIQ-01
ACME-2026-000102;12345678000190;SENIOR;2026-07-23;DUPLICATA;NF-8842/2;2;3;98765432000121;Comercial Acme Ltda;11222333000181;Varejo Beta SA;2026-07-20;2026-09-22;10000.00;9455.10;18.500000;PRE;;S;CTA-LIQ-01
```
