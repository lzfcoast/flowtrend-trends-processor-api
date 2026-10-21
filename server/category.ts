const CATEGORY_RULES: Array<[string, RegExp]> = [
  [
    "Esportes",
    /futebol|jogo|\btime\b|campeonato|copa|atleta|nba|esporte|surf|tenis|tênis|wta|olimpi|olimpí|liga|gol|torneio|vallecano|vasco|flamengo|corinthians/,
  ],
  [
    "Política",
    /política|politica|presidente|senado|senador|câmara|camara|governo|ministro|eleição|eleicao|deputado|bolsonaro|lula|congresso|stf/,
  ],
  [
    "Economia",
    /economia|dólar|dolar|ibovespa|empresa|lucro|inflação|inflacao|mercado|ações|acoes|banco|juros|pib|negócio|negocio|finance/,
  ],
  [
    "Tecnologia",
    /tecnologia|celular|iphone|android|playstation|software|inteligência artificial|inteligencia artificial|a\.i\.|\bai\b|\btech\b|google|microsoft|apple|samsung|disney\+|paramount\+/,
  ],
  [
    "Entretenimento",
    /filme|série|serie|música|musica|artista|novela|celebridade|ator|atriz|cinema|tv|televisão|televisao|netflix|hulu|reality|show/,
  ],
  [
    "Saúde",
    /saúde|saude|hospital|médico|medico|doença|doenca|vacina|sus|pandemia|sintoma|tratamento/,
  ],
  [
    "Brasil",
    /brasil|brasileiro|brasileira|são paulo|sao paulo|rio de janeiro|minas gerais|bahia|paraná|parana/,
  ],
];

export function inferArticleCategory(
  ...values: Array<string | null | undefined>
): string {
  const haystack = values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLocaleLowerCase("pt-BR");

  for (const [category, rule] of CATEGORY_RULES) {
    if (rule.test(haystack)) return category;
  }
  return "Tendências";
}
