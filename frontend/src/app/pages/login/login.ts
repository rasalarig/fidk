import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <section class="login-brand">
        <div style="display:flex;align-items:center;gap:16px">
          <img src="/logo.svg" alt="" style="width:60px;height:60px" />
          <div>
            <div style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1">FIDK</div>
            <div style="font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a94a1;margin-top:5px">Gestão de FIDCs</div>
          </div>
        </div>
        <div>
          <div class="big">Gestão de FIDC do recebível à cota.</div>
          <p class="lede">Ativo e passivo no mesmo lugar: importação de boletas em alto volume,
            apuração de PL e valor de cota, com trilha de auditoria e conformidade CVM 175.</p>
          <div class="feat-row"><svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Ingestão vetorizada e idempotente</div>
          <div class="feat-row"><svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Marcação na curva (252 dias úteis)</div>
          <div class="feat-row"><svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Fechamento selável e versionado</div>
        </div>
        <div class="mono" style="color:#6b7686;font-size:11.5px;letter-spacing:.1em">© FIDK · AMBIENTE LOCAL</div>
      </section>

      <section class="login-form-side">
        <div class="login-card stack gap16">
          <div>
            <h2>Entrar</h2>
            <p class="muted" style="margin:4px 0 0;font-size:14px">Acesse com suas credenciais.</p>
          </div>

          @if (erro()) {
            <div class="alert err">{{ erro() }}</div>
          }

          <div class="field">
            <label>E-mail</label>
            <input class="input" type="email" [(ngModel)]="email" (keyup.enter)="entrar()" placeholder="voce@gestora.com" autocomplete="username" />
          </div>
          <div class="field">
            <label>Senha</label>
            <input class="input" type="password" [(ngModel)]="senha" (keyup.enter)="entrar()" placeholder="••••••••" autocomplete="current-password" />
          </div>

          <button class="btn btn-primary" (click)="entrar()" [disabled]="carregando()" style="justify-content:center">
            @if (carregando()) { <span class="spin"></span> Entrando… } @else { Entrar }
          </button>

          <p class="muted mono" style="font-size:11.5px;text-align:center">seed: admin&#64;fidk.local / trocar&#64;123</p>
        </div>
      </section>
    </div>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = 'admin@fidk.local';
  senha = '';
  carregando = signal(false);
  erro = signal<string | null>(null);

  async entrar() {
    if (this.carregando()) return;
    this.erro.set(null);
    this.carregando.set(true);
    try {
      await this.auth.login(this.email.trim(), this.senha);
      this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      const detail = e?.error?.detail;
      this.erro.set(typeof detail === 'string' ? detail : 'Não foi possível entrar. Verifique as credenciais.');
    } finally {
      this.carregando.set(false);
    }
  }
}
