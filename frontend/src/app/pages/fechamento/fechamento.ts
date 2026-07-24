import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Classe, Fechamento, Fundo } from '../../core/models';
import { brl, cota, dataBR, pct, qtd } from '../../core/format';

@Component({
  selector: 'app-fechamento',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <h2>Fechamento &amp; valor de cota</h2>
      <p>Apure PL, valor de cota e quantidade de cotas por classe numa data. Reprocessar gera nova versão; selar torna o dia imutável.</p>
    </div>

    <div class="card pad" style="margin-bottom:16px">
      <div class="wrap-actions">
        <div class="field" style="min-width:220px">
          <label>Fundo</label>
          <select class="input" [(ngModel)]="fundoId" (ngModelChange)="onFundo($event)">
            <option [ngValue]="null" disabled>Selecione…</option>
            @for (f of fundos(); track f.id) { <option [ngValue]="f.id">{{ f.nome }}</option> }
          </select>
        </div>
        <div class="field" style="min-width:180px">
          <label>Classe</label>
          <select class="input" [(ngModel)]="classeId" (ngModelChange)="onClasse()">
            <option [ngValue]="null" disabled>Selecione…</option>
            @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.codigo }} — {{ c.nome }}</option> }
          </select>
        </div>
        <div class="field" style="min-width:160px">
          <label>Data de referência</label>
          <input class="input" type="date" [(ngModel)]="dataRef" />
        </div>
        <button class="btn btn-primary" [disabled]="!classeId || processando()" (click)="executar()">
          @if (processando()) { <span class="spin"></span> Apurando… } @else { Executar fechamento }
        </button>
      </div>

      <div class="row gap12" style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:14px">
        <div class="field" style="max-width:200px">
          <label>Aporte (emite cotas)</label>
          <input class="input tnum" type="number" [(ngModel)]="valorAporte" placeholder="100000" />
        </div>
        <button class="btn btn-dark btn-sm" style="align-self:flex-end;margin-bottom:1px" [disabled]="!classeId || !valorAporte || processando()" (click)="aportar()">Registrar aporte</button>
      </div>

      @if (msg(); as m) { <div class="alert {{ m.tipo }}" style="margin-top:12px">{{ m.texto }}</div> }
    </div>

    @if (detalhe(); as d) {
      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <h3>Composição do PL — {{ dataBR(d.data_referencia) }} (v{{ d.versao }})</h3>
          @if (d.status === 'SELADO') { <span class="chip ok">selado</span> } @else {
            <button class="btn btn-ghost btn-sm" (click)="selar(d.id)">Selar dia</button>
          }
        </div>
        <div class="card-body">
          <div class="grid g4" style="gap:12px;margin-bottom:16px">
            <div class="comp"><span>Ativos (curva)</span><b class="tnum">{{ brl(d.valor_presente_ativos) }}</b></div>
            <div class="comp"><span>Caixa</span><b class="tnum">{{ brl(d.caixa) }}</b></div>
            <div class="comp"><span>(−) PDD</span><b class="tnum">{{ brl(d.pdd_total) }}</b></div>
            <div class="comp"><span>(−) Provisão adm.</span><b class="tnum">{{ brl(d.provisao_adm_acumulada) }}</b></div>
          </div>
          <div class="grid g4" style="gap:12px">
            <div class="comp strong"><span>PL bruto</span><b class="tnum">{{ brl(d.pl_bruto) }}</b></div>
            <div class="comp strong teal"><span>PL líquido</span><b class="tnum">{{ brl(d.pl_liquido) }}</b></div>
            <div class="comp strong"><span>Quantidade de cotas</span><b class="tnum">{{ qtd(d.quantidade_cotas) }}</b></div>
            <div class="comp strong amber"><span>Valor da cota</span><b class="tnum">{{ cota(d.valor_cota) }}</b></div>
          </div>
        </div>
      </div>
    }

    <div class="card">
      <div class="card-head"><h3>Histórico de fechamentos</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Data</th><th>Versão</th><th>Status</th><th class="num">PL líquido</th><th class="num">Qtd. cotas</th><th class="num">Valor cota</th><th class="num">Rentab.</th><th></th></tr>
          </thead>
          <tbody>
            @for (f of fechamentos(); track f.id) {
              <tr style="cursor:pointer" (click)="abrir(f)">
                <td>{{ dataBR(f.data_referencia) }}</td>
                <td class="mono">v{{ f.versao }}</td>
                <td>@if (f.status === 'SELADO') { <span class="chip ok">selado</span> } @else { <span class="chip neutral">processado</span> }</td>
                <td class="num">{{ brl(f.pl_liquido) }}</td>
                <td class="num">{{ qtd(f.quantidade_cotas) }}</td>
                <td class="num">{{ cota(f.valor_cota) }}</td>
                <td class="num" [class.pos]="pos(f)" [class.neg]="neg(f)">{{ pct(f.rentabilidade_dia) }}</td>
                <td class="num">@if (f.status !== 'SELADO') { <button class="btn btn-ghost btn-sm" (click)="selar(f.id); $event.stopPropagation()">Selar</button> }</td>
              </tr>
            } @empty {
              <tr><td colspan="8"><div class="empty">Selecione uma classe e execute um fechamento.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .comp { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
    .comp span { font-size: 11px; color: var(--slate); font-family: var(--mono); text-transform: uppercase; letter-spacing: .05em; }
    .comp b { font-size: 18px; font-weight: 700; }
    .comp.strong { background: #fafbfc; }
    .comp.teal b { color: var(--teal-deep); }
    .comp.amber b { color: var(--amber); }
  `],
})
export class FechamentoPage {
  private api = inject(ApiService);
  brl = brl; cota = cota; pct = pct; qtd = qtd; dataBR = dataBR;

  fundos = signal<Fundo[]>([]);
  classes = signal<Classe[]>([]);
  fechamentos = signal<Fechamento[]>([]);
  detalhe = signal<Fechamento | null>(null);

  fundoId: string | null = null;
  classeId: string | null = null;
  dataRef = '2026-07-23';
  valorAporte: number | null = null;

  processando = signal(false);
  msg = signal<{ tipo: string; texto: string } | null>(null);

  constructor() {
    this.api.fundos().subscribe((f) => {
      this.fundos.set(f);
      if (f.length === 1) { this.fundoId = f[0].id; this.onFundo(f[0].id); }
    });
  }

  onFundo(id: string) {
    this.classeId = null;
    this.classes.set([]);
    this.fechamentos.set([]);
    this.detalhe.set(null);
    if (!id) return;
    this.api.classes(id).subscribe((c) => {
      this.classes.set(c);
      if (c.length === 1) { this.classeId = c[0].id; this.onClasse(); }
    });
  }

  onClasse() {
    this.detalhe.set(null);
    if (!this.classeId) return;
    this.recarregar();
  }

  recarregar() {
    if (!this.classeId) return;
    this.api.fechamentos(this.classeId).subscribe((f) => this.fechamentos.set(f));
  }

  executar() {
    if (!this.classeId) return;
    this.processando.set(true);
    this.msg.set(null);
    this.api.executarFechamento(this.classeId, this.dataRef).subscribe({
      next: (f) => {
        this.detalhe.set(f);
        this.msg.set({ tipo: 'ok', texto: `Fechamento de ${dataBR(f.data_referencia)} apurado (v${f.versao}). Cota: ${cota(f.valor_cota)}.` });
        this.processando.set(false);
        this.recarregar();
      },
      error: (e) => {
        this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha ao executar o fechamento.' });
        this.processando.set(false);
      },
    });
  }

  aportar() {
    if (!this.classeId || !this.valorAporte) return;
    this.processando.set(true);
    this.msg.set(null);
    this.api.aporte(this.classeId, this.dataRef, this.valorAporte).subscribe({
      next: (r: any) => {
        this.msg.set({ tipo: 'ok', texto: `Aporte de ${brl(r.valor_financeiro)} registrado — ${qtd(r.cotas_emitidas)} cotas emitidas a ${cota(r.valor_cota_aplicada)}.` });
        this.processando.set(false);
        this.valorAporte = null;
      },
      error: (e) => {
        this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha ao registrar o aporte.' });
        this.processando.set(false);
      },
    });
  }

  selar(id: string) {
    this.api.selarFechamento(id).subscribe({
      next: () => {
        this.msg.set({ tipo: 'ok', texto: 'Fechamento selado.' });
        this.recarregar();
        if (this.detalhe()?.id === id) this.abrirId(id);
      },
      error: (e) => this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha ao selar.' }),
    });
  }

  abrir(f: Fechamento) { this.abrirId(f.id); }
  abrirId(id: string) {
    this.api.fechamentoDetalhe(id).subscribe((d) => this.detalhe.set(d));
  }

  pos(f: Fechamento) { return parseFloat(f.rentabilidade_dia ?? '0') > 0; }
  neg(f: Fechamento) { return parseFloat(f.rentabilidade_dia ?? '0') < 0; }
}
