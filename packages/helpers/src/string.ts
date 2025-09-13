import { slug } from 'github-slugger';

export const slugify = (str: string) => slug(str);

// Unicode-aware regex helpers (compiled once)
const RE_CAMEL_BOUNDARY = /([\p{Ll}])([\p{Lu}])/gu;
const RE_ACRONYM_BOUNDARY = /([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu;
const RE_LETTER_DIGIT = /([\p{L}])(\p{N})/gu;
const RE_DIGIT_LETTER = /(\p{N})([\p{L}])/gu;
const RE_TOKENIZE = /[\p{L}\p{N}]+|[^\p{L}\p{N}]/gu;
const RE_SPACE = /^\s+$/u;
const RE_ALNUM = /^[\p{L}\p{N}]+$/u;
const RE_NUM = /^[\p{N}]+$/u;
const RE_ALL_UPPER = /^[\p{Lu}]+$/u;
const RE_SINGLE_LETTER = /^\p{L}$/u;

const pascalize = (token: string): string => {
  if (RE_NUM.test(token)) return token; // numeric-only
  if (!RE_ALNUM.test(token)) return token; // symbol or punctuation
  if (RE_ALL_UPPER.test(token)) return token.toLowerCase(); // HTML -> html
  const lower = token.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/**
 * Split a string into tokens.
 * - Inserts boundaries on camelCase and letter↔digit transitions.
 * - Returns alphanumeric runs as tokens and preserves non-alphanumeric
 *   characters as single-character tokens, except hyphen/underscore which
 *   are treated as delimiters (not returned) so case converters can
 *   reinsert their own join character.
 */
const splitIntoWords = (str: string): string[] => {
  if (!str) return [];

  let s = str;

  // Insert boundaries for casing and number transitions
  s = s.replace(RE_CAMEL_BOUNDARY, '$1 $2');
  s = s.replace(RE_ACRONYM_BOUNDARY, '$1 $2');
  s = s.replace(RE_LETTER_DIGIT, '$1 $2');
  s = s.replace(RE_DIGIT_LETTER, '$1 $2');

  // Tokenize: alphanumeric runs or single non-alphanumeric chars
  const tokens = s.match(RE_TOKENIZE) ?? [];

  return tokens
    .filter((t) => !RE_SPACE.test(t)) // drop spaces
    .filter((t) => t !== '-' && t !== '_'); // treat -/_ as delimiters
};

export const fromUrl = (url: string): string => {
  // Remove protocol and domain if present
  const path = url.replace(/^https?:\/\/[^/]+/, '');

  // Split by '/' and filter out empty segments
  const segments = path.split('/').filter((segment) => segment.length > 0);

  // Convert each segment to PascalCase and join
  return segments
    .map((segment, index) =>
      index === 0 ? toCamelCase(segment) : toPascalCase(segment)
    )
    .filter(Boolean)
    .join('');
};

/**
 * Convert a string to PascalCase
 *
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The PascalCase string
 */
export const toPascalCase = (str: string, joinChar: string = '') => {
  const words = splitIntoWords(str);
  if (words.length === 0) return undefined;

  return words.map(pascalize).join(joinChar);
};

/**
 * Convert a string to kebab-case
 *
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The kebab-case string
 */
export const toKebabCase = (str: string, joinChar: string = '-') => {
  const tokens = splitIntoWords(str);
  if (tokens.length === 0) return undefined;

  const filtered: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    // Drop single-letter+digits version pair (e.g., V 2) between words
    if (RE_SINGLE_LETTER.test(cur) && next && RE_NUM.test(next)) {
      i += 1;
      continue;
    }
    filtered.push(cur);
  }

  return filtered
    .map((t) => (RE_ALNUM.test(t) ? t.toLowerCase() : t))
    .join(joinChar);
};

/**
 * Convert a string to snake_case
 *
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The snake_case string
 */
export const toSnakeCase = (str: string) => toKebabCase(str, '_');

/**
 * Convert a string to Capitalized
 *
 * @param s - The string to convert
 * @returns The capitalized string
 */
export const toCapitalized = (s: string) =>
  s.replace(/(^|(?<=[^\p{L}\p{N}_]))(\p{L})/gu, (_, p1: string, p2: string) => p1 + p2.toUpperCase());

/**
 * Convert a string to camelCase
 *
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The camelCase string
 */
export const toCamelCase = (str: string, joinChar: string = '') => {
  const tokens = splitIntoWords(str);
  if (tokens.length === 0) return '';
  if (tokens.length === 1 && RE_NUM.test(tokens[0])) return tokens[0];

  const startsWithNumber = RE_NUM.test(tokens[0]);
  const endsWithNumber = tokens.length > 1 && RE_NUM.test(tokens[tokens.length - 1]);

  // Build alpha/symbol portion: drop numeric-only tokens for camel body, strip digits from mixed tokens
  const bodyTokens = tokens
    .filter((t) => !RE_NUM.test(t))
    .map((t) => (RE_ALNUM.test(t) ? t.replace(/\p{N}+/gu, '') : t))
    .filter((t) => t.length > 0);

  const pascal = bodyTokens.map(pascalize).join(joinChar);
  const camelAlpha = pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : '';

  if (startsWithNumber && endsWithNumber) {
    return `${tokens[0]}_${camelAlpha}${camelAlpha ? '_' : ''}${tokens[tokens.length - 1]}`;
  }
  if (startsWithNumber) {
    return camelAlpha ? `${tokens[0]}_${camelAlpha}` : tokens[0];
  }
  if (endsWithNumber) {
    return camelAlpha ? `${camelAlpha}_${tokens[tokens.length - 1]}` : tokens[tokens.length - 1];
  }
  return camelAlpha;
};
