import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Fechamento, Fundo, Lote } from '../../core/models';
import { brl, cota, dataBR, pct, qtd } from '../../core/format';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <h2>Visão geral</h2>
      <p>Posição consolidada das carteiras — PL, valor de cota e movimentos recentes.</p>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi">
        <div class="label">Fundos ativos</div>
        <div class="value tnum">{{ fundos().length }}</div>
        <div class="delta muted">carteiras sob gestão</div>
      </div>
      <div class="kpi">
        <div class="label">PL líquido (último)</div>
        <div class="value tnum">{{ brl(ultimo()?.pl_liquido) }}</div>
        <div class="delta muted">{{ ultimo() ? dataBR(ultimo()!.data_referencia) : '—' }}</div>
      </div>
      <div class="kpi amber">
        <div class="label">Valor da cota</div>
        <div class="value tnum">{{ cota(ultimo()?.valor_cota) }}</div>
        <div class="delta muted">{{ ultimo()?.status || '—' }}</div>
      </div>
      <div class="kpi ink">
        <div class="label">Rentabilidade (dia)</div>
        <div class="value tnum" [class.pos]="rentabPos()" [class.neg]="rentabNeg()">{{ pct(ultimo()?.rentabilidade_dia) }}</div>
        <div class="delta muted">no último fechamento</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 2fr 1fr; gap:16px; margin-bottom:16px">
      <div class="card">
        <div class="card-head">
          <h3>Evolução do valor da cota</h3>
          <span class="chip neutral">{{ serie().length }} fechamentos</span>
        </div>
        <div class="card-body">
          @if (serie().length >= 2) {
            <svg [attr.viewBox]="'0 0 ' + CW + ' ' + CH" preserveAspectRatio="none" style="width:100%;height:180px">
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0e9c74" stop-opacity="0.18" />
                  <stop offset="100%" stop-color="#0e9c74" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path [attr.d]="areaPath()" fill="url(#fill)" />
              <path [attr.d]="linePath()" fill="none" stroke="#0e9c74" stroke-width="2" />
              <circle [attr.cx]="lastX()" [attr.cy]="lastY()" r="3.5" fill="#0a6e52" />
            </svg>
            <div class="row between muted" style="font-size:12px;margin-top:6px">
              <span>{{ dataBR(serie()[0].data_referencia) }}</span>
              <span>{{ dataBR(serie()[serie().length - 1].data_referencia) }}</span>
            </div>
          } @else {
            <div class="empty">Sem histórico suficiente para o gráfico. Execute ao menos dois fechamentos.</div>
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Importações recentes</h3></div>
        <div class="card-body stack gap12">
          @for (l of lotes().slice(0, 5); track l.id) {
            <div class="row between gap12" style="font-size:13px">
              <div class="stack">
                <span style="font-weight:600">{{ l.arquivo_nome }}</span>
                <span class="muted mono" style="font-size:11px">{{ dataBR(l.data_referencia) }}</span>
              </div>
              <div class="row gap8">
                <span class="chip ok">{{ l.linhas_aceitas }} ok</span>
                @if (l.linhas_rejeitadas > 0) { <span class="chip crit">{{ l.linhas_rejeitadas }} rej</span> }
              </div>
            </div>
          } @empty {
            <div class="empty">Nenhuma importação ainda. <a routerLink="/boletas">Importar boletas</a></div>
          }
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Últimos fechamentos</h3>
        <a class="btn btn-ghost btn-sm" routerLink="/fechamento">Ver todos</a>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Data</th><th>Versão</th><th>Status</th><th class="num">PL líquido</th><th class="num">Qtd. cotas</th><th class="num">Valor cota</th><th class="num">Rentab.</th></tr>
          </thead>
          <tbody>
            @for (f of fechamentos().slice(0, 8); track f.id) {
              <tr>
                <td>{{ dataBR(f.data_referencia) }}</td>
                <td class="mono">v{{ f.versao }}</td>
                <td>@if (f.status === 'SELADO') { <span class="chip ok">selado</span> } @else { <span class="chip neutral">processado</span> }</td>
                <td class="num">{{ brl(f.pl_liquido) }}</td>
                <td class="num">{{ qtd(f.quantidade_cotas) }}</td>
                <td class="num">{{ cota(f.valor_cota) }}</td>
                <td class="num" [class.pos]="pos(f)" [class.neg]="neg(f)">{{ pct(f.rentabilidade_dia) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7"><div class="empty">Nenhum fechamento executado.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class Dashboard {
  private api = inject(ApiService);
  brl = brl; cota = cota; pct = pct; dataBR = dataBR; qtd = qtd;

  readonly CW = 600;
  readonly CH = 160;

  fundos = signal<Fundo[]>([]);
  fechamentos = signal<Fechamento[]>([]);
  lotes = signal<Lote[]>([]);

  ultimo = computed<Fechamento | undefined>(() => this.fechamentos().at(0));
  rentabPos = computed(() => parseFloat(this.ultimo()?.rentabilidade_dia ?? '0') > 0);
  rentabNeg = computed(() => parseFloat(this.ultimo()?.rentabilidade_dia ?? '0') < 0);

  // série ascendente por data (última versão de cada data), só com valor de cota
  serie = computed<Fechamento[]>(() => {
    const porData = new Map<string, Fechamento>();
    for (const f of this.fechamentos()) {
      if (f.valor_cota === null) continue;
      if (!porData.has(f.data_referencia)) porData.set(f.data_referencia, f); // desc → 1ª é a maior versão
    }
    return [...porData.values()].sort((a, b) => a.data_referencia.localeCompare(b.data_referencia));
  });

  private vals = computed(() => this.serie().map((f) => parseFloat(f.valor_cota!)));
  private minV = computed(() => Math.min(...this.vals()));
  private maxV = computed(() => Math.max(...this.vals()));

  private pts = computed(() => {
    const s = this.serie();
    const n = s.length;
    const min = this.minV();
    const range = this.maxV() - min || 1;
    const pad = 8;
    return this.vals().map((v, i) => {
      const x = n === 1 ? this.CW / 2 : (i / (n - 1)) * (this.CW - pad * 2) + pad;
      const y = this.CH - pad - ((v - min) / range) * (this.CH - pad * 2);
      return { x, y };
    });
  });

  linePath = computed(() => this.pts().map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  areaPath = computed(() => {
    const p = this.pts();
    if (p.length < 2) return '';
    return `M${p[0].x},${this.CH} ` + p.map((q) => `L${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ') + ` L${p[p.length - 1].x},${this.CH} Z`;
  });
  lastX = computed(() => this.pts().at(-1)?.x ?? 0);
  lastY = computed(() => this.pts().at(-1)?.y ?? 0);

  pos(f: Fechamento) { return parseFloat(f.rentabilidade_dia ?? '0') > 0; }
  neg(f: Fechamento) { return parseFloat(f.rentabilidade_dia ?? '0') < 0; }

  constructor() {
    this.api.fundos().subscribe((f) => this.fundos.set(f));
    this.api.fechamentos().subscribe((f) => this.fechamentos.set(f));
    this.api.lotes().subscribe((l) => this.lotes.set(l));
  }
}
