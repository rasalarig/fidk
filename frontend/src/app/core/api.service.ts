import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './auth.service';
import { Classe, Cotista, Fechamento, Fundo, ImportacaoResultado, Lote, RelatorioPosicao, Rejeicao } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  fundos(): Observable<Fundo[]> {
    return this.http.get<Fundo[]>(`${API_BASE}/fundos`);
  }

  classes(fundoId: string): Observable<Classe[]> {
    return this.http.get<Classe[]>(`${API_BASE}/fundos/${fundoId}/classes`);
  }

  importarBoleta(file: File): Observable<ImportacaoResultado> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportacaoResultado>(`${API_BASE}/boletas/importar`, form);
  }

  lotes(): Observable<Lote[]> {
    return this.http.get<Lote[]>(`${API_BASE}/boletas/lotes`);
  }

  rejeicoes(loteId: string): Observable<Rejeicao[]> {
    return this.http.get<Rejeicao[]>(`${API_BASE}/boletas/lotes/${loteId}/rejeicoes`);
  }

  fechamentos(classeId?: string): Observable<Fechamento[]> {
    const q = classeId ? `?classe_id=${classeId}` : '';
    return this.http.get<Fechamento[]>(`${API_BASE}/fechamento${q}`);
  }

  executarFechamento(classeId: string, dataReferencia: string): Observable<Fechamento> {
    return this.http.post<Fechamento>(`${API_BASE}/fechamento/executar`, {
      classe_id: classeId,
      data_referencia: dataReferencia,
    });
  }

  fechamentoDetalhe(id: string): Observable<Fechamento> {
    return this.http.get<Fechamento>(`${API_BASE}/fechamento/${id}`);
  }

  selarFechamento(id: string): Observable<{ id: string; status: string }> {
    return this.http.post<{ id: string; status: string }>(`${API_BASE}/fechamento/${id}/selar`, {});
  }

  aporte(classeId: string, data: string, valor: number): Observable<any> {
    return this.http.post(`${API_BASE}/passivo/aporte`, {
      classe_id: classeId,
      data,
      valor,
    });
  }

  cotistas(): Observable<Cotista[]> {
    return this.http.get<Cotista[]>(`${API_BASE}/passivo/cotistas`);
  }

  criarCotista(body: Partial<Cotista>): Observable<Cotista> {
    return this.http.post<Cotista>(`${API_BASE}/passivo/cotistas`, body);
  }

  aplicacao(classeId: string, cotistaId: string, data: string, valor: number): Observable<any> {
    return this.http.post(`${API_BASE}/passivo/aplicacao`, {
      classe_id: classeId, cotista_id: cotistaId, data, valor,
    });
  }

  resgate(classeId: string, cotistaId: string, data: string, quantidade: number): Observable<any> {
    return this.http.post(`${API_BASE}/passivo/resgate`, {
      classe_id: classeId, cotista_id: cotistaId, data, quantidade,
    });
  }

  relatorioPosicao(classeId: string, data: string): Observable<RelatorioPosicao> {
    return this.http.get<RelatorioPosicao>(`${API_BASE}/relatorio/posicao?classe_id=${classeId}&data=${data}`);
  }
}
