import type { SpecialistKey } from "./specialist-seed.ts";

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

const financialPattern = /\b(financeir[oa]|faturas?|cobrancas?|boletos?|pix|pagamentos?|pagar|pendenc\w*|vencid\w*|segunda via|codigo de barras|qr code de pagamento|asaas)\b/;
const supportPattern = /\b(suporte|ti|erros?|bugs?|falha\w*|trav\w*|conexa\w*|conect\w*|desconect\w*|qr code|nao abre|nao funciona|nao gera|geracao de artes?|gerar artes?)\b/;
const generalPattern = /\b(geral|duvidas?|informacoes?|produtos?|pacotes?|planos?|precos?|valores?|contratar|contratacao|teste gratis|download|baixar|google play|app store|site|scanner|loterica digital|artes automaticas)\b/;
const downloadPattern = /\b(download|baixar|google play|app store)\b/;

export function classifySpecialist(message: string): SpecialistKey | null {
  const content = normalized(message);
  if (!content.trim()) return null;
  if (downloadPattern.test(content)) return "geral";
  if (financialPattern.test(content)) return "financeiro";
  if (supportPattern.test(content)) return "suporte_ti";
  if (generalPattern.test(content)) return "geral";
  return null;
}
