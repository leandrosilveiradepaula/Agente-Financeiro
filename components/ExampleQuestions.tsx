import { MessageSquareText } from "lucide-react";

const EXAMPLE_QUESTIONS = [
  "Qual foi o OPEX do último mês?",
  "Quais marcas tiveram maior receita no último mês?",
  "Quais centros de custo mais estouraram o orçamento?",
  "Qual foi a receita por centro de custo no último mês?"
];

type ExampleQuestionsProps = {
  onSelectQuestion: (question: string) => void;
};

export function ExampleQuestions({ onSelectQuestion }: ExampleQuestionsProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-lake" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">Perguntas sugeridas</h2>
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
      <p className="mt-3 text-sm text-steel">
        Ou faça qualquer outra pergunta sobre os dados financeiros disponíveis.
      </p>
    </section>
  );
}
