import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Classe, Fundo } from '../../core/models';
import { extrairErro } from '../../core/format';
import { MaskDocDirective } from '../../core/mask-doc.directive';

@Component({
  selector: 'app-fundos',
  imports: [FormsModule, MaskDocDirective],
  template: `
    <div class="page-head">
      <h2>Fundos &amp; classes</h2>
      <p>Cadastre os FIDCs e suas classes de cotas (com taxas e prazos de cotização). É o primeiro passo antes de importar boletas e apurar cotas.</p>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px">
      <!-- Novo fundo -->
      <div class="card pad">
        <h3 style="font-size:15px;margin-bottom:14px">Novo fundo</h3>
        <div class="stack gap12">
          <div class="field"><label>CNPJ</label><input class="input mono" maskDoc [(ngModel)]="fundo.cnpj" placeholder="00.000.000/0000-00" /></div>
          <div class="field"><label>Nome do fundo</label><input class="input" [(ngModel)]="fundo.nome" placeholder="FIDC Crédito Corporativo I" /></div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Gestor</label><input class="input" [(ngModel)]="fundo.gestor" /></div>
            <div class="field"><label>Administrador</label><input class="input" [(ngModel)]="fundo.administrador" /></div>
          </div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Custodiante</label><input class="input" [(ngModel)]="fundo.custodiante" /></div>
            <div class="field"><label>Data de início</label><input class="input" type="date" [(ngModel)]="fundo.data_inicio" /></div>
          </div>
          <button class="btn btn-primary" style="justify-content:center" [disabled]="!fundo.cnpj || !fundo.nome" (click)="criarFundo()">Cadastrar fundo</button>
        </div>
      </div>

      <!-- Nova classe -->
      <div class="card pad">
        <h3 style="font-size:15px;margin-bottom:14px">Nova classe de cotas</h3>
        <div class="stack gap12">
          <div class="field"><label>Fundo</label>
            <select class="input" [(ngModel)]="classe.fundo_id">
              <option [ngValue]="null" disabled>Selecione…</option>
              @for (f of fundos(); track f.id) { <option [ngValue]="f.id">{{ f.nome }}</option> }
            </select>
          </div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Código</label><input class="input mono" [(ngModel)]="classe.codigo" placeholder="SENIOR" /></div>
            <div class="field"><label>Tipo</label>
              <select class="input" [(ngModel)]="classe.tipo">
                <option value="SENIOR">Sênior</option>
                <option value="MEZANINO">Mezanino</option>
                <option value="SUBORDINADA">Subordinada</option>
              </select>
            </div>
          </div>
          <div class="field"><label>Nome da classe</label><input class="input" [(ngModel)]="classe.nome" placeholder="Cota Sênior" /></div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Taxa adm. (% a.a.)</label><input class="input tnum" type="number" step="0.01" [(ngModel)]="classe.taxa_administracao_aa" /></div>
            <div class="field"><label>Taxa gestão (% a.a.)</label><input class="input tnum" type="number" step="0.01" [(ngModel)]="classe.taxa_gestao_aa" /></div>
          </div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Cotização aplic. (D+)</label><input class="input tnum" type="number" [(ngModel)]="classe.prazo_cotizacao_aplicacao" /></div>
            <div class="field"><label>Cotização resgate (D+)</label><input class="input tnum" type="number" [(ngModel)]="classe.prazo_cotizacao_resgate" /></div>
          </div>
          <div class="field"><label>Vigência dos parâmetros</label><input class="input" type="date" [(ngModel)]="classe.vigencia_inicio" /></div>
          <button class="btn btn-dark" style="justify-content:center" [disabled]="!classe.fundo_id || !classe.codigo || !classe.nome" (click)="criarClasse()">Cadastrar classe</button>
        </div>
      </div>
    </div>

    @if (msg(); as m) { <div class="alert {{ m.tipo }}" style="margin-bottom:16px">{{ m.texto }}</div> }

    <!-- Lista -->
    <div class="card">
      <div class="card-head"><h3>Fundos cadastrados</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Fundo</th><th>CNPJ</th><th>Situação</th><th>Classes</th></tr></thead>
          <tbody>
            @for (f of fundos(); track f.id) {
              <tr style="cursor:pointer" (click)="verClasses(f)">
                <td style="font-weight:600">{{ f.nome }}</td>
                <td class="mono">{{ f.cnpj }}</td>
                <td>@if (f.situacao === 'ATIVO') { <span class="chip ok">ativo</span> } @else { <span class="chip warn">{{ f.situacao }}</span> }</td>
                <td>
                  @if (classesPorFundo()[f.id]; as cs) {
                    @for (c of cs; track c.id) { <span class="chip neutral" style="margin-right:4px">{{ c.codigo }}</span> }
                    @if (!cs.length) { <span class="muted" style="font-size:12px">— clique para ver</span> }
                  } @else { <span class="muted" style="font-size:12px">clique para ver</span> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4"><div class="empty">Nenhum fundo cadastrado. Comece criando um fundo acima.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class Fundos {
  private api = inject(ApiService);

  fundos = signal<Fundo[]>([]);
  classesPorFundo = signal<Record<string, Classe[]>>({});
  msg = signal<{ tipo: string; texto: string } | null>(null);

  fundo = { cnpj: '', nome: '', gestor: '', administrador: '', custodiante: '', data_inicio: '' };
  classe = {
    fundo_id: null as string | null, codigo: '', nome: '', tipo: 'SENIOR',
    taxa_administracao_aa: 0, taxa_gestao_aa: 0,
    prazo_cotizacao_aplicacao: 0, prazo_cotizacao_resgate: 0,
    vigencia_inicio: new Date().toISOString().slice(0, 10),
  };

  constructor() {
    this.recarregar();
  }

  recarregar() {
    this.api.fundos().subscribe((f) => {
      this.fundos.set(f);
      if (f.length === 1 && !this.classe.fundo_id) this.classe.fundo_id = f[0].id;
    });
  }

  verClasses(f: Fundo) {
    this.classe.fundo_id = f.id;
    this.api.classes(f.id).subscribe((cs) => {
      this.classesPorFundo.update((m) => ({ ...m, [f.id]: cs }));
    });
  }

  criarFundo() {
    this.msg.set(null);
    const body: Record<string, unknown> = {
      cnpj: this.fundo.cnpj, nome: this.fundo.nome, gestor: this.fundo.gestor,
      administrador: this.fundo.administrador, custodiante: this.fundo.custodiante,
    };
    if (this.fundo.data_inicio) body['data_inicio'] = this.fundo.data_inicio;
    this.api.criarFundo(body).subscribe({
      next: (f) => {
        this.msg.set({ tipo: 'ok', texto: `Fundo "${f.nome}" cadastrado.` });
        this.fundo = { cnpj: '', nome: '', gestor: '', administrador: '', custodiante: '', data_inicio: '' };
        this.recarregar();
      },
      error: (e) => this.msg.set({ tipo: 'err', texto: extrairErro(e, 'Falha ao cadastrar o fundo.') }),
    });
  }

  criarClasse() {
    this.msg.set(null);
    const fundoId = this.classe.fundo_id;
    if (!fundoId) return;
    const body = {
      codigo: this.classe.codigo, nome: this.classe.nome, tipo: this.classe.tipo,
      taxa_administracao_aa: this.classe.taxa_administracao_aa,
      taxa_gestao_aa: this.classe.taxa_gestao_aa,
      prazo_cotizacao_aplicacao: this.classe.prazo_cotizacao_aplicacao,
      prazo_cotizacao_resgate: this.classe.prazo_cotizacao_resgate,
      vigencia_inicio: this.classe.vigencia_inicio,
    };
    this.api.criarClasse(fundoId, body).subscribe({
      next: (c) => {
        this.msg.set({ tipo: 'ok', texto: `Classe "${c.codigo}" cadastrada.` });
        this.classe.codigo = '';
        this.classe.nome = '';
        const f = this.fundos().find((x) => x.id === fundoId);
        if (f) this.verClasses(f);
      },
      error: (e) => this.msg.set({ tipo: 'err', texto: extrairErro(e, 'Falha ao cadastrar a classe.') }),
    });
  }
}
