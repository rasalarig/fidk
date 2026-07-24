function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? null : n;
}

export function brl(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function cota(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function qtd(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? '—' : (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + '%';
}

/** Extrai uma mensagem legível de qualquer formato de erro HTTP (inclui 422 do FastAPI). */
export function extrairErro(e: any, fallback = 'Ocorreu um erro.'): string {
  const d = e?.error?.detail ?? e?.error?.message ?? e?.message;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x: any) => x?.msg ?? JSON.stringify(x)).join('; ');
  if (d && typeof d === 'object') return d.msg ?? JSON.stringify(d);
  return fallback;
}

export function dataBR(v: string | null | undefined): string {
  if (!v) return '—';
  const [y, m, d] = v.split('T')[0].split('-');
  return d && m && y ? `${d}/${m}/${y}` : v;
}
