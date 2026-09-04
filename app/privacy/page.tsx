import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Politica de Privacidade | Agente Financeiro",
  description: "Politica de privacidade do Agente Financeiro para uso interno autorizado."
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-700">
          Agente Financeiro
        </p>
        <h1 className="text-3xl font-bold tracking-normal text-slate-950">Política de Privacidade</h1>

        <div className="mt-8 space-y-5 text-base leading-7 text-slate-700">
          <p>
            O Agente Financeiro é uma aplicação interna destinada à consulta de informações
            financeiras autorizadas. As mensagens enviadas ao agente podem ser processadas para
            geração de consultas SQL, execução de análises e retorno de relatórios executivos.
          </p>
          <p>
            A aplicação não deve ser usada para envio de dados pessoais sensíveis. O acesso deve
            ser restrito a usuários autorizados.
          </p>
          <p>
            As informações processadas são utilizadas exclusivamente para responder às solicitações
            feitas pelo usuário e melhorar a experiência de consulta financeira.
          </p>
          <p>
            Para dúvidas sobre privacidade ou solicitação de remoção de dados, entre em contato
            pelo e-mail:{" "}
            <a className="font-semibold text-blue-700 underline" href="mailto:leandrosilveiradepaula@gmail.com">
              leandrosilveiradepaula@gmail.com
            </a>
            .
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
