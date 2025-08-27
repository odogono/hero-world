import { slug } from 'github-slugger';

export const slugify = (str: string) => slug(str);

export const fromUrl = (url: string): string => {
  // Remove protocol and domain if present
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  
  // Split by '/' and filter out empty segments
  const segments = path.split('/').filter(segment => segment.length > 0);
  
  // Convert each segment to PascalCase and join
  return segments
    .map((segment, index) => index === 0 ? toCamelCase(segment) : toPascalCase(segment))
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
export const toPascalCase = (str: string, joinChar: string = '') =>
  str
    .match(/[A-Z]?[a-z]+/g)
    ?.map(word => toCapitalized(word))
    .join(joinChar);



/**
 * Convert a string to kebab-case
 * 
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The kebab-case string
 */
export const toKebabCase = (str: string, joinChar: string = '-') =>
  str
    .match(/[A-Z]?[a-z]+/g)
    ?.map(word => word.toLowerCase())
    .join(joinChar);


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
  s.replaceAll(/\b\w/g, c => c.toUpperCase());

/**
 * Convert a string to camelCase
 * 
 * @param str - The string to convert
 * @param joinChar - The character to join the words with
 * @returns The camelCase string
 */
export const toCamelCase = (str: string, joinChar: string = '') => {
  const result = toPascalCase(str, joinChar);
  return result ? result.charAt(0).toLowerCase() + result.slice(1) : '';
};
