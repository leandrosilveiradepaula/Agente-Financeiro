import { MessageSquareText } from "lucide-react";

const EXAMPLE_QUESTIONS = [
  "Quais as contas que tiveram maiores estouros de orçamento no mês?",
  "Qual foi a principal variação entre orçado e realizado que afetou nosso resultado neste mês?",
  "Monte uma tabela com os resultados do mês por marca e classifique quais as marcas com melhor desempenho em valor e em % sobre ROL",
  "Monte uma tabela com os principais centros de custos, e classifique do melhor desempenho para o pior desempenho",
  "Gostaria de saber qual o setor dos maiores impactos de OPEX de cada marca, preciso saber quais setores custam mais e têm maior representatividade em cada marca"
];

type ExampleQuestionsProps = {
  onSelectQuestion: (question: string) => void;
};

export function ExampleQuestions({ onSelectQuestion }: ExampleQuestionsProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-lake" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">Perguntas padrão</h2>
      </div>

      <div className="flex flex-col gap-2">
        {EXAMPLE_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onSelectQuestion(question)}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-left text-sm leading-5 text-ink transition hover:border-blue-300 hover:bg-blue-50"
          >
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}
