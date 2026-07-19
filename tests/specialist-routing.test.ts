import assert from "node:assert/strict";
import test from "node:test";
import { classifySpecialist } from "../lib/specialist-routing.ts";

test("routes billing requests to finance", () => {
  assert.equal(classifySpecialist("Preciso da segunda via do boleto vencido"), "financeiro");
  assert.equal(classifySpecialist("Pode mandar o QR code de pagamento?"), "financeiro");
});

test("routes connection and art errors to technical support", () => {
  assert.equal(classifySpecialist("Meu WhatsApp não conecta"), "suporte_ti");
  assert.equal(classifySpecialist("A geração de arte travou"), "suporte_ti");
});

test("routes product, plan and download questions to general", () => {
  assert.equal(classifySpecialist("Quais são os planos e preços?"), "geral");
  assert.equal(classifySpecialist("Onde faço o download na App Store?"), "geral");
});

test("keeps unclassified conversation in its current specialist", () => {
  assert.equal(classifySpecialist("Entendi, obrigado"), null);
});
