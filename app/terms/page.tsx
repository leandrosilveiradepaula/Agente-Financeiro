import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Termos de Servico | Agente Financeiro",
  description: "Termos de servico do Agente Financeiro para usuarios autorizados."
};

export default function TermsPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-700">
          Agente Financeiro
        </p>
        <h1 className="text-3xl font-bold tracking-normal text-slate-950">Termos de Serviço</h1>

        <div className="mt-8 space-y-5 text-base leading-7 text-slate-700">
          <p>
            O Agente Financeiro é uma ferramenta de apoio à análise financeira e operacional. O
            uso da aplicação é destinado a usuários autorizados.
          </p>
          <p>
            As respostas geradas pelo agente, incluindo consultas SQL, tabelas, resumos executivos
            e análises, devem ser revisadas antes de qualquer tomada de decisão financeira,
            contábil, fiscal ou operacional.
          </p>
          <p>
            O usuário é responsável por validar as informações retornadas, bem como por garantir
            que possui autorização para consultar os dados solicitados.
          </p>
          <p>
            O serviço pode passar por alterações, interrupções ou ajustes sem aviso prévio durante
            o período de desenvolvimento e homologação.
          </p>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-5">
          <Link className="text-sm font-semibold text-teal-700 hover:text-teal-800" href="/">
            Voltar para o Agente Financeiro
          </Link>
        </div>
      </section>
    </main>
  );
}
