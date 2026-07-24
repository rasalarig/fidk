import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { Shell } from './layout/shell';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'boletas', loadComponent: () => import('./pages/boletas/boletas').then((m) => m.Boletas) },
      { path: 'fechamento', loadComponent: () => import('./pages/fechamento/fechamento').then((m) => m.FechamentoPage) },
      { path: 'cotistas', loadComponent: () => import('./pages/cotistas/cotistas').then((m) => m.Cotistas) },
      { path: 'relatorio', loadComponent: () => import('./pages/relatorio/relatorio').then((m) => m.Relatorio) },
    ],
  },
  { path: '**', redirectTo: '' },
];
