import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

function maskCPF(d: string): string {
  d = d.slice(0, 11);
  let o = d.slice(0, 3);
  if (d.length > 3) o += '.' + d.slice(3, 6);
  if (d.length > 6) o += '.' + d.slice(6, 9);
  if (d.length > 9) o += '-' + d.slice(9, 11);
  return o;
}

function maskCNPJ(d: string): string {
  d = d.slice(0, 14);
  let o = d.slice(0, 2);
  if (d.length > 2) o += '.' + d.slice(2, 5);
  if (d.length > 5) o += '.' + d.slice(5, 8);
  if (d.length > 8) o += '/' + d.slice(8, 12);
  if (d.length > 12) o += '-' + d.slice(12, 14);
  return o;
}

/** Formata CPF (000.000.000-00) até 11 dígitos, senão CNPJ (00.000.000/0000-00). */
export function formatarDocumento(v: string): string {
  const d = (v || '').replace(/\D/g, '');
  return d.length <= 11 ? maskCPF(d) : maskCNPJ(d);
}

/**
 * Máscara de digitação de CPF/CNPJ. Formata ao digitar; o modelo recebe o valor
 * já mascarado (o backend normaliza para só dígitos ao salvar).
 */
@Directive({ selector: '[maskDoc]' })
export class MaskDocDirective {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private control = inject(NgControl, { optional: true });

  @HostListener('input')
  onInput(): void {
    const input = this.el.nativeElement;
    const masked = formatarDocumento(input.value);
    input.value = masked;
    this.control?.control?.setValue(masked, { emitEvent: false });
  }
}
