import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Exclusao de Dados | Agente Financeiro",
  description: "Instrucoes para solicitar exclusao de dados relacionados ao Agente Financeiro."
};

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-700">
          Agente Financeiro
        </p>
        <h1 className="text-3xl font-bold tracking-normal text-slate-950">Exclusão de Dados</h1>

        <div className="mt-8 space-y-5 text-base leading-7 text-slate-700">
          <p>
            Caso deseje solicitar a exclusão de dados relacionados ao uso do Agente Financeiro,
            envie uma solicitação para:{" "}
            <a className="font-semibold text-blue-700 underline" href="mailto:leandrosilveiradepaula@gmail.com">
              leandrosilveiradepaula@gmail.com
            </a>
            .
          </p>
          <div>
            <p>Inclua na solicitação:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Nome completo</li>
              <li>E-mail ou telefone usado na interação com o agente</li>
              <li>Descrição da solicitação de exclusão</li>
            </ul>
          </div>
          <p>
            Após o recebimento, a solicitação será analisada e os dados aplicáveis serão removidos
            dos registros locais da aplicação, quando existentes.
          </p>
          <p>
            Esta página também serve como instrução pública de exclusão de dados para configuração
            do aplicativo na plataforma Meta.
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
