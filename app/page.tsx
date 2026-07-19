import type { Metadata } from "next";
import { AtendimentoApp } from "./components/atendimento-app";

export const metadata: Metadata = {
  title: "Atendimento | Inovalot Panel",
  description: "Central de atendimento jurídico integrada ao WhatsApp.",
};

export default function Home() {
  return <AtendimentoApp />;
}
