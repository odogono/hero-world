import { describe, expect, it } from 'bun:test';

import {
  fromUrl,
  toCamelCase,
  toCapitalized,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from '../string';

describe('String utility functions', () => {
  describe('fromUrl', () => {
    it.each([
      ['/hello-world', 'helloWorld'],
      ['/my-variable-name', 'myVariableName'],
      ['/my-variable-name/hello-world', 'myVariableNameHelloWorld'],
      [
        'https://example.com/my-variable-name/hello-world',
        'myVariableNameHelloWorld',
      ],
    ])('should convert URL to camelCase: %s -> %s', (input, expected) => {
      expect(fromUrl(input)).toBe(expected);
    });
  });

  describe('toPascalCase', () => {
    it.each([
      ['helloWorld', 'HelloWorld'],
      ['myVariableName', 'MyVariableName'],
    ])(
      'should convert camelCase to PascalCase: %s -> %s',
      (input, expected) => {
        expect(toPascalCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello-world', 'HelloWorld'],
      ['my-variable-name', 'MyVariableName'],
    ])(
      'should convert kebab-case to PascalCase: %s -> %s',
      (input, expected) => {
        expect(toPascalCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello_world', 'HelloWorld'],
      ['my_variable_name', 'MyVariableName'],
    ])(
      'should convert snake_case to PascalCase: %s -> %s',
      (input, expected) => {
        expect(toPascalCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello world', 'HelloWorld'],
      ['my variable name', 'MyVariableName'],
    ])(
      'should convert space separated words to PascalCase: %s -> %s',
      (input, expected) => {
        expect(toPascalCase(input)).toBe(expected);
      }
    );

    it.each([
      [['hello-world', '-'], 'Hello-World'],
      [['my_variable_name', '_'], 'My_Variable_Name'],
    ])(
      'should handle custom join character: %s -> %s',
      ([input, joinChar], expected) => {
        expect(toPascalCase(input!, joinChar)).toBe(expected);
      }
    );

    it.each([
      ['hello', 'Hello'],
      ['world', 'World'],
    ])('should handle single word: %s -> %s', (input, expected) => {
      expect(toPascalCase(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(toPascalCase('')).toBeUndefined();
    });

    it.each([
      ['user123Name', 'User123Name'],
      ['api-v2-endpoint', 'ApiV2Endpoint'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toPascalCase(input)).toBe(expected);
    });

    it.each([
      ['hello123', 'Hello123'],
      ['123Hello', '123Hello'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toPascalCase(input)).toBe(expected);
    });
  });

  describe('toKebabCase', () => {
    it.each([
      ['helloWorld', 'hello-world'],
      ['myVariableName', 'my-variable-name'],
      [
        'myExtendedNameVersion2Specialized',
        'my-extended-name-version-2-specialized',
      ],
    ])(
      'should convert camelCase to kebab-case: %s -> %s',
      (input, expected) => {
        expect(toKebabCase(input)).toBe(expected);
      }
    );

    it.each([
      ['HelloWorld', 'hello-world'],
      ['MyVariableName', 'my-variable-name'],
    ])(
      'should convert PascalCase to kebab-case: %s -> %s',
      (input, expected) => {
        expect(toKebabCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello_world', 'hello-world'],
      ['my_variable_name', 'my-variable-name'],
    ])(
      'should convert snake_case to kebab-case: %s -> %s',
      (input, expected) => {
        expect(toKebabCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello world', 'hello-world'],
      ['my variable name', 'my-variable-name'],
    ])(
      'should convert space separated words to kebab-case: %s -> %s',
      (input, expected) => {
        expect(toKebabCase(input)).toBe(expected);
      }
    );

    it.each([
      [['helloWorld', '_'], 'hello_world'],
      [['myVariableName', '.'], 'my.variable.name'],
    ])(
      'should handle custom join character: %s -> %s',
      ([input, joinChar], expected) => {
        expect(toKebabCase(input!, joinChar)).toBe(expected);
      }
    );

    it.each([
      ['hello', 'hello'],
      ['world', 'world'],
    ])('should handle single word: %s -> %s', (input, expected) => {
      expect(toKebabCase(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(toKebabCase('')).toBeUndefined();
    });

    it.each([
      ['user123Name', 'user-123-name'],
      ['apiV2Endpoint', 'api-endpoint'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toKebabCase(input)).toBe(expected);
    });

    it.each([
      ['hello123', 'hello-123'],
      ['123Hello', '123-hello'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toKebabCase(input)).toBe(expected);
    });
  });

  describe('toSnakeCase', () => {
    it.each([
      ['helloWorld', 'hello_world'],
      ['myVariableName', 'my_variable_name'],
    ])(
      'should convert camelCase to snake_case: %s -> %s',
      (input, expected) => {
        expect(toSnakeCase(input)).toBe(expected);
      }
    );

    it.each([
      ['HelloWorld', 'hello_world'],
      ['MyVariableName', 'my_variable_name'],
    ])(
      'should convert PascalCase to snake_case: %s -> %s',
      (input, expected) => {
        expect(toSnakeCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello-world', 'hello_world'],
      ['my-variable-name', 'my_variable_name'],
    ])(
      'should convert kebab-case to snake_case: %s -> %s',
      (input, expected) => {
        expect(toSnakeCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello world', 'hello_world'],
      ['my variable name', 'my_variable_name'],
    ])(
      'should convert space separated words to snake_case: %s -> %s',
      (input, expected) => {
        expect(toSnakeCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello', 'hello'],
      ['world', 'world'],
    ])('should handle single word: %s -> %s', (input, expected) => {
      expect(toSnakeCase(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(toSnakeCase('')).toBeUndefined();
    });

    it.each([
      ['user123Name', 'user_123_name'],
      ['apiV2Endpoint', 'api_endpoint'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toSnakeCase(input)).toBe(expected);
    });

    it.each([
      ['hello123', 'hello_123'],
      ['123Hello', '123_hello'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toSnakeCase(input)).toBe(expected);
    });
  });

  describe('toCapitalized', () => {
    it.each([
      ['hello world', 'Hello World'],
      ['my variable name', 'My Variable Name'],
    ])(
      'should capitalize first letter of each word: %s -> %s',
      (input, expected) => {
        expect(toCapitalized(input)).toBe(expected);
      }
    );

    it.each([
      ['hello', 'Hello'],
      ['world', 'World'],
    ])('should handle single word: %s -> %s', (input, expected) => {
      expect(toCapitalized(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(toCapitalized('')).toBe('');
    });

    it.each([
      ['Hello World', 'Hello World'],
      ['My Variable Name', 'My Variable Name'],
    ])(
      'should handle already capitalized words: %s -> %s',
      (input, expected) => {
        expect(toCapitalized(input)).toBe(expected);
      }
    );

    it.each([
      ['hello WORLD', 'Hello WORLD'],
      ['MY variable Name', 'MY Variable Name'],
    ])('should handle mixed case: %s -> %s', (input, expected) => {
      expect(toCapitalized(input)).toBe(expected);
    });

    it.each([
      ['user123 name', 'User123 Name'],
      ['api v2 endpoint', 'Api V2 Endpoint'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toCapitalized(input)).toBe(expected);
    });

    it.each([
      ['hello-world', 'Hello-World'],
      ['my_variable_name', 'My_variable_name'],
    ])('should handle special characters: %s -> %s', (input, expected) => {
      expect(toCapitalized(input)).toBe(expected);
    });

    it.each([
      ['hello123', 'Hello123'],
      ['123Hello', '123Hello'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toCapitalized(input)).toBe(expected);
    });
  });

  describe('toCamelCase', () => {
    it.each([
      ['HelloWorld', 'helloWorld'],
      ['MyVariableName', 'myVariableName'],
    ])(
      'should convert PascalCase to camelCase: %s -> %s',
      (input, expected) => {
        expect(toCamelCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello-world', 'helloWorld'],
      ['my-variable-name', 'myVariableName'],
    ])(
      'should convert kebab-case to camelCase: %s -> %s',
      (input, expected) => {
        expect(toCamelCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello_world', 'helloWorld'],
      ['my_variable_name', 'myVariableName'],
    ])(
      'should convert snake_case to camelCase: %s -> %s',
      (input, expected) => {
        expect(toCamelCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello world', 'helloWorld'],
      ['my variable name', 'myVariableName'],
    ])(
      'should convert space separated words to camelCase: %s -> %s',
      (input, expected) => {
        expect(toCamelCase(input)).toBe(expected);
      }
    );

    it.each([
      [['hello-world', '-'], 'hello-World'],
      [['my_variable_name', '_'], 'my_Variable_Name'],
    ])(
      'should handle custom join character: %s -> %s',
      ([input, joinChar], expected) => {
        expect(toCamelCase(input!, joinChar)).toBe(expected);
      }
    );

    it.each([
      ['hello', 'hello'],
      ['world', 'world'],
    ])('should handle single word: %s -> %s', (input, expected) => {
      expect(toCamelCase(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(toCamelCase('')).toBe('');
    });

    it.each([
      ['user123Name', 'userName'],
      ['api-v2-endpoint', 'apiVEndpoint'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toCamelCase(input)).toBe(expected);
    });

    it.each([
      ['helloWorld', 'helloWorld'],
      ['myVariableName', 'myVariableName'],
    ])(
      'should handle already camelCase strings: %s -> %s',
      (input, expected) => {
        expect(toCamelCase(input)).toBe(expected);
      }
    );

    it.each([
      ['hello123', 'hello_123'],
      ['123Hello', '123_hello'],
    ])('should handle strings with numbers: %s -> %s', (input, expected) => {
      expect(toCamelCase(input)).toBe(expected);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null and undefined inputs gracefully', () => {
      // These should be handled by TypeScript, but we test the behavior
      expect(() => toPascalCase('')).not.toThrow();
      expect(() => toKebabCase('')).not.toThrow();
      expect(() => toSnakeCase('')).not.toThrow();
      expect(() => toCapitalized('')).not.toThrow();
      expect(() => toCamelCase('')).not.toThrow();
    });

    it('should handle strings with only numbers', () => {
      expect(toPascalCase('123')).toBe('123');
      expect(toKebabCase('123')).toBe('123');
      expect(toSnakeCase('123')).toBe('123');
      expect(toCapitalized('123')).toBe('123');
      expect(toCamelCase('123')).toBe('123');
    });

    it('should handle strings with special characters', () => {
      expect(toPascalCase('hello@world')).toBe('Hello@World');
      expect(toKebabCase('hello@world')).toBe('hello-@-world');
      expect(toSnakeCase('hello@world')).toBe('hello_@_world');
      expect(toCapitalized('hello@world')).toBe('Hello@World');
      expect(toCamelCase('hello@world')).toBe('hello@World');
    });

    it('should handle strings with multiple consecutive capitals', () => {
      expect(toPascalCase('HTMLParser')).toBe('htmlParser');
      expect(toKebabCase('HTMLParser')).toBe('html-parser');
      expect(toSnakeCase('HTMLParser')).toBe('html_parser');
      expect(toCapitalized('HTMLParser')).toBe('HTMLParser');
      expect(toCamelCase('HTMLParser')).toBe('htmlParser');
    });
  });

  describe('Unicode and emoji handling', () => {
    it('should preserve emoji tokens across conversions', () => {
      expect(toPascalCase('hello🍄world')).toBe('Hello🍄World');
      expect(toKebabCase('hello🍄world')).toBe('hello-🍄-world');
      expect(toSnakeCase('hello🍄world')).toBe('hello_🍄_world');
      expect(toCamelCase('hello🍄world')).toBe('hello🍄World');
      expect(toCapitalized('hello🍄world')).toBe('Hello🍄World');
    });

    it('should handle non-Latin letters with casing and delimiters', () => {
      // Cyrillic: ПриветМир
      expect(toPascalCase('ПриветМир')).toBe('ПриветМир');
      expect(toKebabCase('ПриветМир')).toBe('привет-мир');
      expect(toSnakeCase('ПриветМир')).toBe('привет_мир');
      expect(toCamelCase('ПриветМир')).toBe('приветМир');
    });

    it('should handle accented Latin letters', () => {
      expect(toPascalCase('Café-Éclair')).toBe('CaféÉclair');
      expect(toKebabCase('Café-Éclair')).toBe('café-éclair');
      expect(toSnakeCase('Café-Éclair')).toBe('café_éclair');
      expect(toCamelCase('Café-Éclair')).toBe('caféÉclair');
      expect(toCapitalized('Café-Éclair')).toBe('Café-Éclair');
    });

    it('should preserve emoji and mixed scripts together', () => {
      expect(toPascalCase('Привет🍄Мир')).toBe('Привет🍄Мир');
      expect(toKebabCase('Привет🍄Мир')).toBe('привет-🍄-мир');
      expect(toSnakeCase('Привет🍄Мир')).toBe('привет_🍄_мир');
      expect(toCamelCase('Привет🍄Мир')).toBe('привет🍄Мир');
    });
  });
});
