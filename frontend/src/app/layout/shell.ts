import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">F</div>
          <div>
            <div class="name">FIDK</div>
            <div class="sub">Controladoria</div>
          </div>
        </div>

        <div class="nav-group">Operação</div>
        <a class="nav-item" routerLink="/dashboard" routerLinkActive="active">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          Dashboard
        </a>
        <a class="nav-item" routerLink="/boletas" routerLinkActive="active">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Importar boletas
        </a>
        <a class="nav-item" routerLink="/fechamento" routerLinkActive="active">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>
          Fechamento &amp; Cota
        </a>

        <div class="nav-group">Passivo</div>
        <a class="nav-item" routerLink="/cotistas" routerLinkActive="active">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Cotistas
        </a>
        <a class="nav-item" routerLink="/relatorio" routerLinkActive="active">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
          Posição diária
        </a>

        <div class="spacer"></div>

        <div class="side-user">
          <div class="who">{{ auth.user()?.nome || '—' }}</div>
          <div class="role">{{ auth.user()?.email }}</div>
          <a class="nav-item" style="margin-top:10px;padding-left:0" (click)="sair()">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sair
          </a>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <h1>{{ secao() }}</h1>
          <span class="chip info"><span class="dot"></span>ambiente local</span>
        </header>
        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class Shell {
  auth = inject(AuthService);
  private router = inject(Router);

  secao(): string {
    const url = this.router.url;
    if (url.includes('boletas')) return 'Importação de boletas';
    if (url.includes('fechamento')) return 'Fechamento & valor de cota';
    if (url.includes('cotistas')) return 'Cotistas & movimentação';
    if (url.includes('relatorio')) return 'Relatório de posição diária';
    return 'Visão geral';
  }

  sair() {
    this.auth.logout();
  }

  constructor() {
    // garante que os dados do usuário estejam carregados após refresh
    if (this.auth.token() && !this.auth.user()) {
      this.auth.carregarUsuario().catch(() => this.auth.logout());
    }
  }
}
