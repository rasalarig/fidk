import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Usuario } from './models';

// Em dev (ng serve na 4288) a API está noutra origem; em produção o próprio
// backend serve o front, então usa a mesma origem (caminho relativo).
export const API_BASE =
  typeof location !== 'undefined' && location.port === '4288' ? 'http://127.0.0.1:8077' : '';
const TOKEN_KEY = 'fidk_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly user = signal<Usuario | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());

  async login(email: string, senha: string): Promise<void> {
    const body = new URLSearchParams();
    body.set('username', email);
    body.set('password', senha);
    const res = await firstValueFrom(
      this.http.post<{ access_token: string }>(`${API_BASE}/auth/login`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    this.setToken(res.access_token);
    await this.carregarUsuario();
  }

  async carregarUsuario(): Promise<void> {
    const u = await firstValueFrom(this.http.get<Usuario>(`${API_BASE}/auth/me`));
    this.user.set(u);
  }

  has(permissao: string): boolean {
    return this.user()?.permissoes?.includes(permissao) ?? false;
  }

  private setToken(t: string): void {
    this.token.set(t);
    localStorage.setItem(TOKEN_KEY, t);
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(TOKEN_KEY);
    this.router.navigateByUrl('/login');
  }
}
