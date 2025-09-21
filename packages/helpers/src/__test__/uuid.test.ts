import { expect, test, describe } from 'bun:test';

import { uuidv7 } from '../uuid';

describe('uuidv7', () => {
  test('should return a defined value', () => {
    expect(uuidv7()).toBeDefined();
  });

  test('should return a string', () => {
    expect(typeof uuidv7()).toBe('string');
  });

  test('should return a valid UUID format', () => {
    const uuid = uuidv7();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });

  test('should have version 7 in the correct position', () => {
    const uuid = uuidv7();
    // Version should be in the 7th character (0-indexed position 14)
    expect(uuid[14]).toBe('7');
  });

  test('should have correct variant bits', () => {
    const uuid = uuidv7();
    // Variant should be in the 8th character (0-indexed position 19)
    // Should be 8, 9, A, or B (binary 10xx)
    const variantChar = uuid[19]?.toLowerCase();
    expect(variantChar).toBeDefined();
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  test('should generate unique values', () => {
    const uuids = new Set();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      uuids.add(uuidv7());
    }

    expect(uuids.size).toBe(count);
  });

  test('should generate values in chronological order', () => {
    const uuid1 = uuidv7();
    // Small delay to ensure different timestamps
    const start = Date.now();
    while (Date.now() - start < 1) {
      // Busy wait for 1ms
    }
    const uuid2 = uuidv7();

    // Extract timestamp from UUID (first 12 hex characters)
    const timestamp1 = parseInt(
      uuid1.substring(0, 8) + uuid1.substring(9, 13),
      16
    );
    const timestamp2 = parseInt(
      uuid2.substring(0, 8) + uuid2.substring(9, 13),
      16
    );

    expect(timestamp2).toBeGreaterThanOrEqual(timestamp1);
  });

  test('should handle multiple rapid calls', () => {
    const uuids = [];
    for (let i = 0; i < 100; i++) {
      uuids.push(uuidv7());
    }

    // All should be unique
    const uniqueUuids = new Set(uuids);
    expect(uniqueUuids.size).toBe(100);

    // All should be valid UUIDs
    uuids.forEach((uuid) => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
      expect(uuid[14]).toBe('7'); // Version 7
    });
  });

  test('should have correct length', () => {
    const uuid = uuidv7();
    expect(uuid.length).toBe(36); // 32 hex chars + 4 hyphens
  });

  test('should contain only valid hex characters and hyphens', () => {
    const uuid = uuidv7();
    const validChars = /^[0-9a-f-]+$/i;
    expect(uuid).toMatch(validChars);
  });
});
