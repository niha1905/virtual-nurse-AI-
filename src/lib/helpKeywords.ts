const HELP_KEYWORDS_BY_LANGUAGE = {
  english: [
    "help",
    "help me",
    "emergency",
    "sos",
    "assist",
    "aid",
    "save me",
    "call doctor",
  ],
  hindi: [
    "\u092e\u0926\u0926",
    "\u092c\u091a\u093e\u0913",
    "\u0906\u092a\u093e\u0924\u0915\u093e\u0932",
    "\u0938\u0939\u093e\u092f\u0924\u093e",
    "madad",
    "bachao",
  ],
  tamil: [
    "\u0b89\u0ba4\u0bb5\u0bbf",
    "\u0b95\u0bbe\u0baa\u0bcd\u0baa\u0bbe\u0bb1\u0bcd\u0bb1\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd",
    "\u0b85\u0bb5\u0b9a\u0bb0\u0bae\u0bcd",
    "udhavi",
    "avasaram",
  ],
  telugu: [
    "\u0c38\u0c39\u0c3e\u0c2f\u0c02",
    "\u0c15\u0c3e\u0c2a\u0c3e\u0c21\u0c02\u0c21\u0c3f",
    "\u0c05\u0c24\u0c4d\u0c2f\u0c35\u0c38\u0c30\u0c02",
    "sahayam",
    "atyavasaram",
  ],
  bengali: [
    "\u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af",
    "\u09ac\u09be\u0981\u099a\u09be\u0993",
    "\u099c\u09b0\u09c1\u09b0\u09bf",
    "sahajjo",
    "joruri",
  ],
  marathi: [
    "\u092e\u0926\u0924",
    "\u0935\u093e\u091a\u0935\u093e",
    "\u0906\u092a\u0924\u094d\u0915\u093e\u0932\u0940\u0928",
    "madat",
    "vachva",
  ],
  gujarati: [
    "\u0aae\u0aa6\u0aa6",
    "\u0aac\u0a9a\u0abe\u0ab5\u0acb",
    "\u0aa4\u0abe\u0aa4\u0acd\u0a95\u0abe\u0ab2\u0abf\u0a95",
    "madad",
    "bachavo",
  ],
  kannada: [
    "\u0cb8\u0cb9\u0cbe\u0caf",
    "\u0c95\u0cbe\u0caa\u0cbe\u0ca1\u0cbf",
    "\u0ca4\u0cc1\u0cb0\u0ccd\u0ca4\u0cc1",
    "sahaya",
    "thurthu",
  ],
  malayalam: [
    "\u0d38\u0d39\u0d3e\u0d2f\u0d02",
    "\u0d30\u0d15\u0d4d\u0d37\u0d3f\u0d15\u0d4d\u0d15\u0d42",
    "\u0d05\u0d1f\u0d3f\u0d2f\u0d28\u0d4d\u0d24\u0d30\u0d02",
    "sahayam",
    "adiyantharam",
  ],
  punjabi: [
    "\u0a2e\u0a26\u0a26",
    "\u0a2c\u0a1a\u0a3e\u0a13",
    "\u0a10\u0a2e\u0a30\u0a1c\u0a48\u0a02\u0a38\u0a40",
    "madad",
    "bachao",
  ],
  odia: [
    "\u0b38\u0b3e\u0b39\u0b3e\u0b2f\u0b4d\u0b5f",
    "\u0b2c\u0b1e\u0b4d\u0b1a\u0b3e\u0b05",
    "\u0b1c\u0b30\u0b41\u0b30\u0b40",
    "sahajya",
    "jaruri",
  ],
} as const;

export type HelpKeywordLanguage = keyof typeof HELP_KEYWORDS_BY_LANGUAGE;

export type HelpKeywordMatch = {
  keyword: string;
  language: HelpKeywordLanguage;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const KEYWORD_ENTRIES = Object.entries(HELP_KEYWORDS_BY_LANGUAGE).flatMap(
  ([language, keywords]) =>
    keywords.map((keyword) => ({
      language: language as HelpKeywordLanguage,
      keyword,
      normalizedKeyword: normalizeText(keyword),
    })),
);

export const HELP_KEYWORDS = KEYWORD_ENTRIES.map((entry) => entry.keyword);

export const findHelpKeywordMatch = (input: string): HelpKeywordMatch | null => {
  const normalizedInput = normalizeText(input);

  for (const entry of KEYWORD_ENTRIES) {
    if (normalizedInput.includes(entry.normalizedKeyword)) {
      return { keyword: entry.keyword, language: entry.language };
    }
  }

  return null;
};

export const containsHelpKeyword = (input: string) => findHelpKeywordMatch(input) !== null;
