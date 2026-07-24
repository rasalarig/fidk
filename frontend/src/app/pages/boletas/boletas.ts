import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ImportacaoResultado, Lote, Rejeicao } from '../../core/models';
import { dataBR } from '../../core/format';

@Component({
  selector: 'app-boletas',
  template: `
    <div class="page-head">
      <h2>Importação de boletas</h2>
      <p>Envie o arquivo de aquisição de recebíveis (CSV com <code>;</code> ou XLSX). A validação é por linha — as válidas entram, as demais são reportadas com o motivo.</p>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px">
      <div class="card pad">
        <div
          class="dropzone"
          [class.over]="over()"
          (dragover)="$event.preventDefault(); over.set(true)"
          (dragleave)="over.set(false)"
          (drop)="onDrop($event)"
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0e9c74" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <div style="font-weight:600;margin-top:8px">Arraste o arquivo aqui</div>
          <div class="muted" style="font-size:13px">ou selecione manualmente</div>
          <input #fileInput type="file" accept=".csv,.xlsx" (change)="onPick($event)" hidden />
          <button class="btn btn-ghost btn-sm" style="margin-top:12px" (click)="fileInput.click()">Selecionar arquivo</button>
          @if (arquivo()) { <div class="chip info" style="margin-top:12px"><span class="dot"></span>{{ arquivo()!.name }}</div> }
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:16px" [disabled]="!arquivo() || enviando()" (click)="importar()">
          @if (enviando()) { <span class="spin"></span> Processando… } @else { Importar boletas }
        </button>
        @if (erro()) { <div class="alert err" style="margin-top:12px">{{ erro() }}</div> }
      </div>

      <div class="card pad">
        @if (resultado(); as r) {
          <div class="row between" style="margin-bottom:14px">
            <h3 style="font-size:15px">Resultado da importação</h3>
            <span class="chip ok">{{ r.status }}</span>
          </div>
          <div class="grid g2" style="gap:10px">
            <div class="mini"><span>Total de linhas</span><b class="tnum">{{ r.linhas_total }}</b></div>
            <div class="mini ok"><span>Aceitas</span><b class="tnum">{{ r.linhas_aceitas }}</b></div>
            <div class="mini crit"><span>Rejeitadas</span><b class="tnum">{{ r.linhas_rejeitadas }}</b></div>
            <div class="mini"><span>Inseridas</span><b class="tnum">{{ r.registros_inseridos }}</b></div>
          </div>
          @if (r.duplicados_ignorados > 0) {
            <div class="alert" style="background:#fbf1df;color:#8a5e12;margin-top:12px">
              {{ r.duplicados_ignorados }} título(s) já existiam e foram ignorados (idempotência).
            </div>
          }
          @if (r.amostra_rejeicoes.length) {
            <div class="eyebrow" style="margin:16px 0 8px">Motivos de rejeição</div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead><tr><th>Linha</th><th>Motivo</th></tr></thead>
                <tbody>
                  @for (rej of r.amostra_rejeicoes; track rej.linha) {
                    <tr><td class="mono">{{ rej.linha }}</td><td>{{ rej.motivo }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else {
          <div class="empty">O resumo da importação aparecerá aqui.</div>
        }
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Lotes importados</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Arquivo</th><th>Referência</th><th>Status</th><th class="num">Total</th><th class="num">Aceitas</th><th class="num">Rejeitadas</th><th></th></tr>
          </thead>
          <tbody>
            @for (l of lotes(); track l.id) {
              <tr>
                <td style="font-weight:600">{{ l.arquivo_nome }}</td>
                <td>{{ dataBR(l.data_referencia) }}</td>
                <td><span class="chip ok">{{ l.status }}</span></td>
                <td class="num">{{ l.linhas_total }}</td>
                <td class="num pos">{{ l.linhas_aceitas }}</td>
                <td class="num" [class.neg]="l.linhas_rejeitadas > 0">{{ l.linhas_rejeitadas }}</td>
                <td class="num">
                  @if (l.linhas_rejeitadas > 0) {
                    <button class="btn btn-ghost btn-sm" (click)="verRejeicoes(l)">Ver rejeições</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7"><div class="empty">Nenhum lote importado ainda.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (rejSelecionadas(); as rejs) {
      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <h3>Rejeições — {{ loteSelecionado()?.arquivo_nome }}</h3>
          <button class="btn btn-ghost btn-sm" (click)="rejSelecionadas.set(null)">Fechar</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Linha</th><th>Identificador</th><th>Motivo</th></tr></thead>
            <tbody>
              @for (r of rejs; track r.linha) {
                <tr><td class="mono">{{ r.linha }}</td><td class="mono">{{ anyId(r) }}</td><td>{{ r.motivo }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
  styles: [`
    .dropzone { border: 2px dashed var(--line); border-radius: 12px; padding: 30px; text-align: center; display: flex; flex-direction: column; align-items: center; transition: border-color .15s, background .15s; }
    .dropzone.over { border-color: var(--teal); background: var(--teal-wash); }
    .mini { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
    .mini span { font-size: 11.5px; color: var(--slate); font-family: var(--mono); text-transform: uppercase; letter-spacing: .06em; }
    .mini b { font-size: 22px; font-weight: 800; }
    .mini.ok b { color: var(--teal-deep); }
    .mini.crit b { color: var(--crit); }
  `],
})
export class Boletas {
  private api = inject(ApiService);
  dataBR = dataBR;

  arquivo = signal<File | null>(null);
  over = signal(false);
  enviando = signal(false);
  erro = signal<string | null>(null);
  resultado = signal<ImportacaoResultado | null>(null);
  lotes = signal<Lote[]>([]);
  rejSelecionadas = signal<Rejeicao[] | null>(null);
  loteSelecionado = signal<Lote | null>(null);

  constructor() {
    this.recarregarLotes();
  }

  onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.arquivo.set(f);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.over.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.arquivo.set(f);
  }

  importar() {
    const f = this.arquivo();
    if (!f) return;
    this.enviando.set(true);
    this.erro.set(null);
    this.api.importarBoleta(f).subscribe({
      next: (r) => {
        this.resultado.set(r);
        this.enviando.set(false);
        this.recarregarLotes();
      },
      error: (e) => {
        this.erro.set(e?.error?.detail ?? 'Falha ao importar o arquivo.');
        this.enviando.set(false);
      },
    });
  }

  recarregarLotes() {
    this.api.lotes().subscribe((l) => this.lotes.set(l));
  }

  verRejeicoes(l: Lote) {
    this.loteSelecionado.set(l);
    this.api.rejeicoes(l.id).subscribe((r) => this.rejSelecionadas.set(r));
  }

  anyId(r: any) {
    return r.identificador_externo ?? '—';
  }
}
