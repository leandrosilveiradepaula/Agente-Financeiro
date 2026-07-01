export type BenchmarkCase = {
  id: string;
  title: string;
  question: string;
  expectedIntent: string;
  expectedTexts: string[];
  expectedWarnings?: string[];
};

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "estouro-orcamento",
    title: "Estouro de orçamento",
    question: "Quais as contas que tiveram maiores estouros de orçamento no mês?",
    expectedIntent: "estouro_orcamento",
    expectedTexts: [
      "A análise identifica os maiores estouros de orçamento do mês, excluindo Receita de Vendas"
    ],
    expectedWarnings: [
      "Receita de Vendas não deve entrar nesta leitura de estouro de orçamento"
    ]
  },
  {
    id: "orcado-vs-realizado",
    title: "Orçado x realizado",
    question:
      "Qual foi a principal variação entre orçado e realizado que afetou nosso resultado neste mês?",
    expectedIntent: "orcado_vs_realizado",
    expectedTexts: ["principal variação observada"]
  },
  {
    id: "comparativo-marcas",
    title: "Resultado por marca",
    question:
      "Monte uma tabela com os resultados do mês por marca e classifique quais as marcas com melhor desempenho em valor e em % sobre ROL",
    expectedIntent: "comparativo_marcas",
    expectedTexts: ["melhor desempenho em valor", "percentual sobre ROL"]
  },
  {
    id: "opex-centro-custo",
    title: "Centros de custo",
    question:
      "Monte uma tabela com os principais centros de custos, e classifique do melhor desempenho para o pior desempenho",
    expectedIntent: "opex_por_centro_custo",
    expectedTexts: ["centros de custo", "Variância positiva indica economia"]
  },
  {
    id: "impacto-setor-marca",
    title: "OPEX por setor e marca",
    question:
      "Gostaria de saber qual o setor dos maiores impactos de OPEX de cada marca, preciso saber quais setores custam mais e têm maior representatividade em cada marca",
    expectedIntent: "impacto_setor_marca",
    expectedTexts: ["peso de cada setor no OPEX", "representatividade"]
  }
];
