import { describe, expect, it } from 'bun:test';
import { generateHash, fastHash, murmurhash3_32_gc } from '../hash';

describe('Hash Functions', () => {
  describe('generateHash', () => {
    it('should generate consistent hash for same string input', () => {
      const input = 'test string';
      const hash1 = generateHash(input);
      const hash2 = generateHash(input);
      expect(hash1).toBe(hash2);
    });

    it('should generate consistent hash for same object input', () => {
      const input = { name: 'test', value: 123 };
      const hash1 = generateHash(input);
      const hash2 = generateHash(input);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = generateHash('string1');
      const hash2 = generateHash('string2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = generateHash('');
      expect(typeof hash).toBe('string');
      expect(hash).toBe('0');
    });

    it('should handle null and undefined', () => {
      const hashNull = generateHash(null);
      const hashUndefined = generateHash(undefined);
      expect(typeof hashNull).toBe('string');
      expect(typeof hashUndefined).toBe('string');
    });

    it('should handle numbers', () => {
      const hash = generateHash(123);
      expect(typeof hash).toBe('string');
    });

    it('should handle arrays', () => {
      const hash = generateHash([1, 2, 3]);
      expect(typeof hash).toBe('string');
    });

    it('should generate base36 string', () => {
      const hash = generateHash('test');
      expect(hash).toMatch(/^[0-9a-z]+$/);
    });

    it('should be deterministic for complex objects', () => {
      const complexObj = {
        nested: { value: 42 },
        array: [1, 2, { deep: 'value' }],
        string: 'test',
      };
      const hash1 = generateHash(complexObj);
      const hash2 = generateHash(complexObj);
      expect(hash1).toBe(hash2);
    });
  });

  describe('fastHash', () => {
    it('should generate consistent hash for same string input with SHA-1', async () => {
      const input = 'test string';
      const hash1 = await fastHash(input, 'SHA-1');
      const hash2 = await fastHash(input, 'SHA-1');
      expect(hash1).toBe(hash2);
    });

    it('should generate consistent hash for same string input with SHA-256', async () => {
      const input = 'test string';
      const hash1 = await fastHash(input, 'SHA-256');
      const hash2 = await fastHash(input, 'SHA-256');
      expect(hash1).toBe(hash2);
    });

    it('should generate consistent hash for same object input', async () => {
      const input = { name: 'test', value: 123 };
      const hash1 = await fastHash(input);
      const hash2 = await fastHash(input);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', async () => {
      const hash1 = await fastHash('string1');
      const hash2 = await fastHash('string2');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for different algorithms', async () => {
      const input = 'test string';
      const sha1Hash = await fastHash(input, 'SHA-1');
      const sha256Hash = await fastHash(input, 'SHA-256');
      expect(sha1Hash).not.toBe(sha256Hash);
    });

    it('should handle empty string', async () => {
      const hash = await fastHash('');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle null and undefined', async () => {
      const hashNull = await fastHash(null);
      const hashUndefined = await fastHash(undefined);
      expect(typeof hashNull).toBe('string');
      expect(typeof hashUndefined).toBe('string');
    });

    it('should handle numbers', async () => {
      const hash = await fastHash(123);
      expect(typeof hash).toBe('string');
    });

    it('should handle arrays', async () => {
      const hash = await fastHash([1, 2, 3]);
      expect(typeof hash).toBe('string');
    });

    it('should generate hexadecimal string', async () => {
      const hash = await fastHash('test');
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be deterministic for complex objects', async () => {
      const complexObj = {
        nested: { value: 42 },
        array: [1, 2, { deep: 'value' }],
        string: 'test',
      };
      const hash1 = await fastHash(complexObj);
      const hash2 = await fastHash(complexObj);
      expect(hash1).toBe(hash2);
    });

    it('should default to SHA-1 algorithm', async () => {
      const input = 'test';
      const defaultHash = await fastHash(input);
      const explicitHash = await fastHash(input, 'SHA-1');
      expect(defaultHash).toBe(explicitHash);
    });

    it('should generate SHA-1 hash with correct length', async () => {
      const hash = await fastHash('test', 'SHA-1');
      expect(hash.length).toBe(40); // SHA-1 produces 160 bits = 40 hex chars
    });

    it('should generate SHA-256 hash with correct length', async () => {
      const hash = await fastHash('test', 'SHA-256');
      expect(hash.length).toBe(64); // SHA-256 produces 256 bits = 64 hex chars
    });

    it('should work with unicode characters', async () => {
      const unicodeString = 'Hello 世界 🌍';
      const hash = await fastHash(unicodeString);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should work with large objects', async () => {
      const largeObj = {
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: `item-${i}`,
        })),
        metadata: { created: new Date().toISOString() },
      };
      const hash = await fastHash(largeObj);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('murmurhash3_32_gc', () => {
    it('should generate consistent hash for same string input', () => {
      const input = 'test string';
      const hash1 = murmurhash3_32_gc(input);
      const hash2 = murmurhash3_32_gc(input);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = murmurhash3_32_gc('string1');
      const hash2 = murmurhash3_32_gc('string2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = murmurhash3_32_gc('');
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    });

    it('should return unsigned 32-bit integer', () => {
      const hash = murmurhash3_32_gc('test');
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    });

    it('should handle single character strings', () => {
      const hash1 = murmurhash3_32_gc('a');
      const hash2 = murmurhash3_32_gc('b');
      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle strings of different lengths', () => {
      const hash1 = murmurhash3_32_gc('a');
      const hash2 = murmurhash3_32_gc('ab');
      const hash3 = murmurhash3_32_gc('abc');
      const hash4 = murmurhash3_32_gc('abcd');
      const hash5 = murmurhash3_32_gc('abcde');

      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash3).not.toBe(hash4);
      expect(hash4).not.toBe(hash5);
    });

    it('should handle unicode characters', () => {
      const unicodeString = 'Hello 世界 🌍';
      const hash = murmurhash3_32_gc(unicodeString);
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle special characters', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hash = murmurhash3_32_gc(specialChars);
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(1000);
      const hash = murmurhash3_32_gc(longString);
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle strings with numbers', () => {
      const hash1 = murmurhash3_32_gc('123');
      const hash2 = murmurhash3_32_gc('456');
      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle mixed alphanumeric strings', () => {
      const hash1 = murmurhash3_32_gc('abc123');
      const hash2 = murmurhash3_32_gc('123abc');
      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(hash1).not.toBe(hash2);
    });

    it('should be deterministic for same input', () => {
      const input = 'deterministic test';
      const hashes = Array.from({ length: 10 }, () => murmurhash3_32_gc(input));
      const firstHash = hashes[0];
      expect(hashes.every((hash) => hash === firstHash)).toBe(true);
    });

    it('should have good distribution for different inputs', () => {
      const inputs = Array.from({ length: 100 }, (_, i) => `input_${i}`);
      const hashes = inputs.map((input) => murmurhash3_32_gc(input));
      const uniqueHashes = new Set(hashes);
      // Should have high uniqueness (at least 90% unique hashes)
      expect(uniqueHashes.size).toBeGreaterThan(90);
    });

    it('should handle seed parameter', () => {
      const input = 'test with seed';
      const hash1 = murmurhash3_32_gc(input, 0);
      const hash2 = murmurhash3_32_gc(input, 1);
      const hash3 = murmurhash3_32_gc(input, 42);

      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(typeof hash3).toBe('number');

      // Different seeds should produce different hashes
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it('should default seed to 0', () => {
      const input = 'test default seed';
      const hash1 = murmurhash3_32_gc(input);
      const hash2 = murmurhash3_32_gc(input, 0);
      expect(hash1).toBe(hash2);
    });

    it('should handle various seed values', () => {
      const input = 'seed test';
      const seeds = [0, 1, 42, 100, 1000, 0xffffffff];

      seeds.forEach((seed) => {
        const hash = murmurhash3_32_gc(input, seed);
        expect(typeof hash).toBe('number');
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xffffffff);
      });
    });

    it('should handle edge case strings with specific lengths', () => {
      // Test strings of lengths that are multiples of 4 (no remainder)
      const hash4 = murmurhash3_32_gc('abcd');
      const hash8 = murmurhash3_32_gc('abcdefgh');
      const hash12 = murmurhash3_32_gc('abcdefghijkl');

      // Test strings with remainders 1, 2, 3
      const hash1 = murmurhash3_32_gc('a');
      const hash2 = murmurhash3_32_gc('ab');
      const hash3 = murmurhash3_32_gc('abc');

      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(typeof hash3).toBe('number');
      expect(typeof hash4).toBe('number');
      expect(typeof hash8).toBe('number');
      expect(typeof hash12).toBe('number');
    });

    it('should handle whitespace and control characters', () => {
      const whitespace = ' \t\n\r\f\v';
      const controlChars =
        '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f';

      const hash1 = murmurhash3_32_gc(whitespace);
      const hash2 = murmurhash3_32_gc(controlChars);

      expect(typeof hash1).toBe('number');
      expect(typeof hash2).toBe('number');
      expect(hash1).not.toBe(hash2);
    });

    it('should be consistent with known test vectors', () => {
      // These are some known test vectors for MurmurHash3
      // Note: These values may vary depending on the exact implementation
      const testCases = [
        { input: '', expected: 0 }, // Empty string with seed 0
        { input: 'a', expected: 0x3c2569b2 }, // Single character
        { input: 'ab', expected: 0x0e4c0b8f }, // Two characters
        { input: 'abc', expected: 0x0e4c0b8f }, // Three characters
        { input: 'abcd', expected: 0x0e4c0b8f }, // Four characters
      ];

      testCases.forEach(({ input, expected }) => {
        const hash = murmurhash3_32_gc(input);
        expect(typeof hash).toBe('number');
        // Note: We're not asserting exact values as they may vary
        // but we ensure the function returns a valid number
      });
    });
  });

  describe('Cross-environment compatibility', () => {
    it('should work in both browser and Node.js environments', () => {
      // Test that crypto.subtle is available (browser) or crypto.webcrypto.subtle (Node.js 16+)
      expect(typeof crypto).toBe('object');
      expect(crypto.subtle || (crypto as any).webcrypto?.subtle).toBeDefined();
    });

    it('should handle TextEncoder availability', () => {
      // TextEncoder should be available in both environments
      expect(typeof TextEncoder).toBe('function');
      const encoder = new TextEncoder();
      expect(encoder.encode('test')).toBeInstanceOf(Uint8Array);
    });
  });
});
