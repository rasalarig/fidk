"""Gerador de arquivos de boleta (aquisição de recebíveis) para testes.

Gera um CSV no layout do contrato (docs/contrato-boleta.md), com linhas válidas,
apontando para um fundo/classe existentes no banco.

Exemplos:
    python tools/gerar_boletas.py                       # 100k -> sample-data/boletas_100k.csv
    python tools/gerar_boletas.py --linhas 500000 --saida sample-data/boletas_500k.csv
    python tools/gerar_boletas.py --cnpj 12345678000190 --classe SENIOR --prefixo P100

Só usa a biblioteca padrão (nenhuma dependência).
"""

import argparse
import os
import random
from datetime import date, timedelta

CABECALHO = (
    "identificador_externo;fundo_cnpj;classe_codigo;data_aquisicao;tipo_ativo;numero_titulo;"
    "numero_parcela;total_parcelas;cedente_documento;cedente_nome;sacado_documento;sacado_nome;"
    "data_emissao;data_vencimento;valor_face;valor_aquisicao;taxa_desconto_aa;indexador;"
    "percentual_indexador;coobrigacao;conta_liquidacao"
)
TIPOS = ["DUPLICATA", "CCB", "CARTAO", "CHEQUE", "NOTA_PROMISSORIA", "CONTRATO"]


def main() -> None:
    p = argparse.ArgumentParser(description="Gera CSV de boletas de recebíveis para teste.")
    p.add_argument("--linhas", type=int, default=100_000)
    p.add_argument("--saida", default=os.path.join("sample-data", "boletas_100k.csv"))
    p.add_argument("--cnpj", default="12345678000190", help="CNPJ do fundo (deve existir no banco)")
    p.add_argument("--classe", default="SENIOR", help="Código da classe (deve existir no fundo)")
    p.add_argument("--prefixo", default="P100", help="Prefixo do identificador_externo (idempotência)")
    p.add_argument("--data", default="2026-07-23", help="Data de aquisição (AAAA-MM-DD)")
    p.add_argument("--seed", type=int, default=2026)
    args = p.parse_args()

    random.seed(args.seed)
    aquis = date.fromisoformat(args.data)

    # pools de contrapartes (exercitam o dedup/upsert na ingestão)
    n_ced = max(200, args.linhas // 100)
    n_sac = max(500, args.linhas // 25)
    cedentes = [(f"{10_000_000_000_000 + i:014d}", f"Cedente {i:04d} Ltda") for i in range(n_ced)]
    sacados = [(f"{20_000_000_000_000 + i:014d}", f"Sacado {i:05d} SA") for i in range(n_sac)]

    os.makedirs(os.path.dirname(os.path.abspath(args.saida)), exist_ok=True)
    with open(args.saida, "w", encoding="utf-8", newline="") as f:
        f.write(CABECALHO + "\n")
        for i in range(1, args.linhas + 1):
            face = round(random.uniform(1_000, 50_000), 2)
            aq = round(face * random.uniform(0.90, 0.99), 2)
            venc = aquis + timedelta(days=random.randint(20, 120))
            ced = random.choice(cedentes)
            sac = random.choice(sacados)
            f.write(
                f"{args.prefixo}-{i:07d};{args.cnpj};{args.classe};{aquis};{random.choice(TIPOS)};"
                f"NT-{i:07d};1;1;{ced[0]};{ced[1]};{sac[0]};{sac[1]};{aquis};{venc};"
                f"{face:.2f};{aq:.2f};;PRE;;S;CTA-LIQ-01\n"
            )

    tam = os.path.getsize(args.saida) / (1024 * 1024)
    print(f"OK: {args.linhas} linhas -> {args.saida} ({tam:.1f} MB)")
    print(f"  fundo={args.cnpj} classe={args.classe} contrapartes={n_ced} cedentes / {n_sac} sacados")


if __name__ == "__main__":
    main()
