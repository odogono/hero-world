import { slug } from 'github-slugger';

export const slugify = (str: string) => slug(str);

export const fromUrl = (url: string): string => {
  // Remove protocol and domain if present
  const path = url.replace(/^https?:\/\/[^\/]+/, '');
  
  // Split by '/' and filter out empty segments
  const segments = path.split('/').filter(segment => segment.length > 0);
  
  // Convert each segment to PascalCase and join
  return segments
    .map(segment => toPascalCase(segment))
    .filter(Boolean)
    .join('');
};

export const toPascalCase = (str: string, joinChar: string = '') =>
  str
    .match(/[A-Z]?[a-z]+/g)
    ?.map((word) => toCapitalized(word))
    .join(joinChar);

export const toKebabCase = (str: string, joinChar: string = '-') =>
  str
    .match(/[A-Z]?[a-z]+/g)
    ?.map((word) => word.toLowerCase())
    .join(joinChar);

export const toSnakeCase = (str: string) => toKebabCase(str, '_');

export const toCapitalized = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

export const toCamelCase = (str: string, joinChar: string = '') => {
  const result = toPascalCase(str, joinChar);
  return result ? result.charAt(0).toLowerCase() + result.substring(1) : '';
};
