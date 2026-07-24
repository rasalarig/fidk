import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Classe, Fundo, RelatorioPosicao } from '../../core/models';
import { brl, cota, dataBR, extrairErro, pct, qtd } from '../../core/format';

@Component({
  selector: 'app-relatorio',
  imports: [FormsModule],
  template: `
    <div class="page-head no-print">
      <h2>Relatório de posição diária</h2>
      <p>Foto consolidada da carteira numa data: composição do PL, estoque de recebíveis e posição de cada cotista.</p>
    </div>

    <div class="card pad no-print" style="margin-bottom:16px">
      <div class="wrap-actions">
        <div class="field" style="min-width:220px"><label>Fundo</label>
          <select class="input" [(ngModel)]="fundoId" (ngModelChange)="onFundo($event)">
            <option [ngValue]="null" disabled>Selecione…</option>
            @for (f of fundos(); track f.id) { <option [ngValue]="f.id">{{ f.nome }}</option> }
          </select>
        </div>
        <div class="field" style="min-width:160px"><label>Classe</label>
          <select class="input" [(ngModel)]="classeId">
            <option [ngValue]="null" disabled>Selecione…</option>
            @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.codigo }}</option> }
          </select>
        </div>
        <div class="field" style="min-width:160px"><label>Data</label><input class="input" type="date" [(ngModel)]="data" /></div>
        <button class="btn btn-primary" [disabled]="!classeId || carregando()" (click)="gerar()">
          @if (carregando()) { <span class="spin"></span> Gerando… } @else { Gerar relatório }
        </button>
        @if (rel()) {
          <button class="btn btn-ghost" (click)="imprimir()">Imprimir / PDF</button>
          <button class="btn btn-ghost" (click)="exportarCsv()">Exportar CSV</button>
        }
      </div>
      @if (erro()) { <div class="alert err" style="margin-top:12px">{{ erro() }}</div> }
    </div>

    @if (rel(); as r) {
      <div class="report card">
        <div class="report-head">
          <div>
            <div class="eyebrow">Relatório de posição diária</div>
            <h2 style="font-size:22px;margin-top:4px">{{ r.fundo.nome }}</h2>
            <div class="muted mono" style="font-size:12.5px;margin-top:2px">CNPJ {{ r.fundo.cnpj }} · Classe {{ r.classe.codigo }} ({{ r.classe.tipo }})</div>
          </div>
          <div style="text-align:right">
            <div class="eyebrow">Data de referência</div>
            <div style="font-size:20px;font-weight:800">{{ dataBR(r.data_referencia) }}</div>
            <div>
              @if (r.fechamento.status === 'SELADO') { <span class="chip ok">selado</span> } @else { <span class="chip neutral">processado</span> }
              <span class="chip neutral mono">v{{ r.fechamento.versao }}</span>
            </div>
          </div>
        </div>

        <div class="report-section">
          <div class="eyebrow">Composição do patrimônio</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:12px">
            <div class="comp"><span>Estoque valorizado</span><b class="tnum">{{ brl(r.composicao.estoque_valorizado) }}</b><small class="muted">{{ r.composicao.estoque_qtd_titulos }} títulos</small></div>
            <div class="comp"><span>Caixa</span><b class="tnum">{{ brl(r.composicao.caixa) }}</b></div>
            <div class="comp"><span>Contas a receber</span><b class="tnum">{{ brl(r.composicao.contas_receber) }}</b><small class="muted">títulos vencidos</small></div>
            <div class="comp"><span>(−) PDD</span><b class="tnum">{{ brl(r.composicao.pdd) }}</b></div>
            <div class="comp"><span>(−) Provisão adm.</span><b class="tnum">{{ brl(r.composicao.provisao_administracao) }}</b></div>
          </div>
          <div class="grid g4" style="gap:12px;margin-top:12px">
            <div class="comp strong"><span>PL bruto</span><b class="tnum">{{ brl(r.fechamento.pl_bruto) }}</b></div>
            <div class="comp strong teal"><span>PL líquido</span><b class="tnum">{{ brl(r.fechamento.pl_liquido) }}</b></div>
            <div class="comp strong"><span>Quantidade de cotas</span><b class="tnum">{{ qtd(r.fechamento.quantidade_cotas) }}</b></div>
            <div class="comp strong amber"><span>Valor da cota</span><b class="tnum">{{ cota(r.fechamento.valor_cota) }}</b></div>
          </div>
        </div>

        <div class="report-section">
          <div class="eyebrow">Posição dos cotistas (passivo)</div>
          <div class="tbl-wrap" style="margin-top:10px">
            <table class="tbl">
              <thead><tr><th>Cotista</th><th>Documento</th><th>Tipo</th><th class="num">Cotas</th><th class="num">Participação</th><th class="num">Valor da posição</th></tr></thead>
              <tbody>
                @for (c of r.cotistas; track c.documento) {
                  <tr>
                    <td style="font-weight:600">{{ c.nome }}</td>
                    <td class="mono">{{ c.documento }}</td>
                    <td>{{ c.tipo_investidor }}</td>
                    <td class="num">{{ qtd(c.cotas) }}</td>
                    <td class="num">{{ pct(c.participacao) }}</td>
                    <td class="num">{{ brl(c.valor) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr style="font-weight:700;background:#fafbfc">
                  <td colspan="5">Total</td>
                  <td class="num">{{ brl(r.fechamento.pl_liquido) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="report-section">
          <div class="eyebrow">Estoque de recebíveis (ativo) — marcação na curva</div>
          <div class="tbl-wrap" style="margin-top:10px">
            <table class="tbl">
              <thead><tr><th>Título</th><th>Tipo</th><th>Vencimento</th><th>Sacado</th><th>Cedente</th><th class="num">Valor de face</th><th class="num">Valor presente</th></tr></thead>
              <tbody>
                @for (t of r.estoque; track t.numero_titulo) {
                  <tr>
                    <td class="mono">{{ t.numero_titulo }}</td>
                    <td>{{ t.tipo }}</td>
                    <td>{{ dataBR(t.vencimento) }}</td>
                    <td>{{ t.sacado }}</td>
                    <td>{{ t.cedente }}</td>
                    <td class="num">{{ brl(t.valor_face) }}</td>
                    <td class="num">{{ brl(t.valor_presente) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr style="font-weight:700;background:#fafbfc">
                  <td colspan="6">Total do estoque</td>
                  <td class="num">{{ brl(r.composicao.estoque_valorizado) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="report-foot muted">
          Emitido em {{ hoje }} · FIDK Controladoria · valores em reais (BRL).
        </div>
      </div>
    } @else if (!erro()) {
      <div class="card"><div class="empty">Selecione a classe e a data e gere o relatório.</div></div>
    }
  `,
  styles: [`
    .report { padding: 28px 30px; }
    .report-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 2px solid var(--ink); }
    .report-section { margin-top: 24px; }
    .comp { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
    .comp span { font-size: 11px; color: var(--slate); font-family: var(--mono); text-transform: uppercase; letter-spacing: .05em; }
    .comp b { font-size: 17px; font-weight: 700; }
    .comp small { font-size: 11px; }
    .comp.strong { background: #fafbfc; }
    .comp.teal b { color: var(--teal-deep); }
    .comp.amber b { color: var(--amber); }
    .report-foot { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; }
  `],
})
export class Relatorio {
  private api = inject(ApiService);
  brl = brl; cota = cota; pct = pct; qtd = qtd; dataBR = dataBR;
  hoje = new Date().toLocaleDateString('pt-BR');

  fundos = signal<Fundo[]>([]);
  classes = signal<Classe[]>([]);
  rel = signal<RelatorioPosicao | null>(null);
  carregando = signal(false);
  erro = signal<string | null>(null);

  fundoId: string | null = null;
  classeId: string | null = null;
  data = '2026-08-14';

  constructor() {
    this.api.fundos().subscribe((f) => {
      this.fundos.set(f);
      if (f.length === 1) { this.fundoId = f[0].id; this.onFundo(f[0].id); }
    });
  }

  onFundo(id: string) {
    this.classeId = null;
    if (!id) return;
    this.api.classes(id).subscribe((c) => { this.classes.set(c); if (c.length === 1) this.classeId = c[0].id; });
  }

  gerar() {
    if (!this.classeId) return;
    this.carregando.set(true);
    this.erro.set(null);
    this.rel.set(null);
    this.api.relatorioPosicao(this.classeId, this.data).subscribe({
      next: (r) => { this.rel.set(r); this.carregando.set(false); },
      error: (e) => { this.erro.set(extrairErro(e, 'Falha ao gerar o relatório.')); this.carregando.set(false); },
    });
  }

  imprimir() { window.print(); }

  exportarCsv() {
    const r = this.rel();
    if (!r) return;
    const linhas: string[] = [];
    linhas.push(`Relatorio de posicao diaria;${r.fundo.nome};${r.data_referencia}`);
    linhas.push('');
    linhas.push('COMPOSICAO;valor');
    linhas.push(`Estoque valorizado;${r.composicao.estoque_valorizado}`);
    linhas.push(`Caixa;${r.composicao.caixa}`);
    linhas.push(`Provisao administracao;${r.composicao.provisao_administracao}`);
    linhas.push(`PL liquido;${r.fechamento.pl_liquido}`);
    linhas.push(`Valor cota;${r.fechamento.valor_cota}`);
    linhas.push('');
    linhas.push('COTISTA;documento;tipo;cotas;participacao;valor');
    for (const c of r.cotistas) linhas.push(`${c.nome};${c.documento};${c.tipo_investidor};${c.cotas};${c.participacao};${c.valor}`);
    linhas.push('');
    linhas.push('TITULO;tipo;vencimento;sacado;cedente;valor_face;valor_presente');
    for (const t of r.estoque) linhas.push(`${t.numero_titulo};${t.tipo};${t.vencimento};${t.sacado};${t.cedente};${t.valor_face};${t.valor_presente}`);

    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `posicao_${r.classe.codigo}_${r.data_referencia}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
