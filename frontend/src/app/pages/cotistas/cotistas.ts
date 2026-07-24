import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Classe, Cotista, Fundo } from '../../core/models';
import { brl, cota, qtd } from '../../core/format';

@Component({
  selector: 'app-cotistas',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <h2>Cotistas &amp; movimentação</h2>
      <p>Cadastre investidores e registre aplicações e resgates. A conversão em cotas usa o valor de cota vigente.</p>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1.4fr; gap:16px; margin-bottom:16px">
      <div class="card pad">
        <h3 style="font-size:15px;margin-bottom:14px">Novo cotista</h3>
        <div class="stack gap12">
          <div class="field"><label>Documento (CPF/CNPJ, só dígitos)</label><input class="input mono" [(ngModel)]="novo.documento" placeholder="11122233344" /></div>
          <div class="field"><label>Nome</label><input class="input" [(ngModel)]="novo.nome" placeholder="Investidor…" /></div>
          <div class="field"><label>Tipo de investidor</label>
            <select class="input" [(ngModel)]="novo.tipo_investidor">
              <option value="GERAL">Geral</option>
              <option value="QUALIFICADO">Qualificado</option>
              <option value="PROFISSIONAL">Profissional</option>
            </select>
          </div>
          <button class="btn btn-primary" style="justify-content:center" [disabled]="!novo.documento || !novo.nome" (click)="criar()">Cadastrar cotista</button>
        </div>
      </div>

      <div class="card pad">
        <h3 style="font-size:15px;margin-bottom:14px">Movimentar (aplicação / resgate)</h3>
        <div class="wrap-actions" style="margin-bottom:12px">
          <div class="field" style="min-width:200px"><label>Fundo</label>
            <select class="input" [(ngModel)]="fundoId" (ngModelChange)="onFundo($event)">
              <option [ngValue]="null" disabled>Selecione…</option>
              @for (f of fundos(); track f.id) { <option [ngValue]="f.id">{{ f.nome }}</option> }
            </select>
          </div>
          <div class="field" style="min-width:150px"><label>Classe</label>
            <select class="input" [(ngModel)]="classeId">
              <option [ngValue]="null" disabled>Selecione…</option>
              @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.codigo }}</option> }
            </select>
          </div>
        </div>
        <div class="wrap-actions">
          <div class="field" style="min-width:190px"><label>Cotista</label>
            <select class="input" [(ngModel)]="cotistaId">
              <option [ngValue]="null" disabled>Selecione…</option>
              @for (c of cotistas(); track c.id) { <option [ngValue]="c.id">{{ c.nome }}</option> }
            </select>
          </div>
          <div class="field" style="min-width:140px"><label>Data</label><input class="input" type="date" [(ngModel)]="data" /></div>
          <div class="field" style="min-width:130px"><label>Valor (aplic.)</label><input class="input tnum" type="number" [(ngModel)]="valor" placeholder="50000" /></div>
          <button class="btn btn-primary" [disabled]="!podeMovimentar() || !valor" (click)="aplicar()">Aplicar</button>
          <div class="field" style="min-width:130px"><label>Cotas (resgate)</label><input class="input tnum" type="number" [(ngModel)]="cotasResgate" placeholder="10000" /></div>
          <button class="btn btn-dark" [disabled]="!podeMovimentar() || !cotasResgate" (click)="resgatar()">Resgatar</button>
        </div>
        @if (msg(); as m) { <div class="alert {{ m.tipo }}" style="margin-top:12px">{{ m.texto }}</div> }
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Cotistas cadastrados</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Nome</th><th>Documento</th><th>Tipo</th><th>Situação</th></tr></thead>
          <tbody>
            @for (c of cotistas(); track c.id) {
              <tr>
                <td style="font-weight:600">{{ c.nome }}</td>
                <td class="mono">{{ c.documento }}</td>
                <td><span class="chip neutral">{{ c.tipo_investidor }}</span></td>
                <td>@if (c.situacao === 'ATIVO') { <span class="chip ok">ativo</span> } @else { <span class="chip warn">inativo</span> }</td>
              </tr>
            } @empty {
              <tr><td colspan="4"><div class="empty">Nenhum cotista cadastrado.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class Cotistas {
  private api = inject(ApiService);
  brl = brl; cota = cota; qtd = qtd;

  fundos = signal<Fundo[]>([]);
  classes = signal<Classe[]>([]);
  cotistas = signal<Cotista[]>([]);

  novo: Partial<Cotista> = { documento: '', nome: '', tipo_investidor: 'GERAL' };
  fundoId: string | null = null;
  classeId: string | null = null;
  cotistaId: string | null = null;
  data = '2026-07-23';
  valor: number | null = null;
  cotasResgate: number | null = null;
  msg = signal<{ tipo: string; texto: string } | null>(null);

  constructor() {
    this.api.fundos().subscribe((f) => {
      this.fundos.set(f);
      if (f.length === 1) { this.fundoId = f[0].id; this.onFundo(f[0].id); }
    });
    this.recarregar();
  }

  recarregar() { this.api.cotistas().subscribe((c) => this.cotistas.set(c)); }

  onFundo(id: string) {
    this.classeId = null;
    if (!id) return;
    this.api.classes(id).subscribe((c) => { this.classes.set(c); if (c.length === 1) this.classeId = c[0].id; });
  }

  podeMovimentar() { return !!this.classeId && !!this.cotistaId; }

  criar() {
    this.msg.set(null);
    this.api.criarCotista(this.novo).subscribe({
      next: () => { this.novo = { documento: '', nome: '', tipo_investidor: 'GERAL' }; this.recarregar(); this.msg.set({ tipo: 'ok', texto: 'Cotista cadastrado.' }); },
      error: (e) => this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha ao cadastrar.' }),
    });
  }

  aplicar() {
    if (!this.classeId || !this.cotistaId || !this.valor) return;
    this.msg.set(null);
    this.api.aplicacao(this.classeId, this.cotistaId, this.data, this.valor).subscribe({
      next: (r) => { this.msg.set({ tipo: 'ok', texto: `Aplicação registrada — ${qtd(r.cotas_emitidas)} cotas a ${cota(r.valor_cota_aplicada)}.` }); this.valor = null; },
      error: (e) => this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha na aplicação.' }),
    });
  }

  resgatar() {
    if (!this.classeId || !this.cotistaId || !this.cotasResgate) return;
    this.msg.set(null);
    this.api.resgate(this.classeId, this.cotistaId, this.data, this.cotasResgate).subscribe({
      next: (r) => { this.msg.set({ tipo: 'ok', texto: `Resgate registrado — ${brl(r.valor_financeiro)} (${qtd(r.cotas_resgatadas)} cotas).` }); this.cotasResgate = null; },
      error: (e) => this.msg.set({ tipo: 'err', texto: e?.error?.detail ?? 'Falha no resgate.' }),
    });
  }
}
