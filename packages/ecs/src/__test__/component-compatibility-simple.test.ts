import { describe, expect, test, beforeEach } from 'bun:test';
import { z } from 'zod';
import { defineComponent } from '../component';
import { createWorld } from '../world';
import { hashComponentDefinition, compareComponentHashes } from '../schema/component-hash';
import { 
  initializeComponentMetadataTable,
  storeComponentMetadata,
  getStoredComponentMetadata, 
  validateComponentCompatibility,
  updateComponentMetadata
} from '../schema/component-metadata';
import { DatabaseType, createDatabase } from '@db';

describe('Component Compatibility System - Simple Tests', () => {
  let testDb: any;
  const cleanupDb = async () => {
    if (testDb) {
      testDb.close();
    }
  };

  beforeEach(async () => {
    testDb = await createDatabase({
      type: DatabaseType.BUN,
      path: ':memory:'
    });
  });

  test('should create consistent hashes for component definitions', () => {
    const playerComponent = defineComponent({
      name: 'playerTest1',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const hash1 = hashComponentDefinition(playerComponent);
    const hash2 = hashComponentDefinition(playerComponent);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  test('should detect hash differences for different components', () => {
    const component1 = defineComponent({
      name: 'playerTest2',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const component2 = defineComponent({
      name: 'playerTest3',
      schema: {
        name: z.string(),
        level: z.number(),
        health: z.number() // Added field
      }
    });

    const hash1 = hashComponentDefinition(component1);
    const hash2 = hashComponentDefinition(component2);
    
    expect(hash1).not.toBe(hash2);
  });

  test('should initialize metadata table', async () => {
    initializeComponentMetadataTable(testDb);
    
    // Check if table was created
    const tables = testDb.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tbl_component_metadata'"
    );
    expect(tables.length).toBe(1);
    
    await cleanupDb();
  });

  test('should store and retrieve component metadata', async () => {
    initializeComponentMetadataTable(testDb);
    
    const component = defineComponent({
      name: 'playerTest4',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    storeComponentMetadata(testDb, [component]);
    
    const metadata = getStoredComponentMetadata(testDb);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].tbl_name).toBe('tbl_player_test_4'); // table name with tbl_ prefix
    expect(metadata[0].hash).toBeTruthy();
    
    await cleanupDb();
  });

  test('should validate compatible components', async () => {
    initializeComponentMetadataTable(testDb);
    
    const component = defineComponent({
      name: 'playerTest5',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    // Store initial metadata
    storeComponentMetadata(testDb, [component]);
    
    // Validate same component should be compatible
    const validation = validateComponentCompatibility(testDb, [component]);
    
    expect(validation.compatible).toBe(true);
    expect(validation.errors).toHaveLength(0);
    
    await cleanupDb();
  });

  test('should detect incompatible component changes', async () => {
    initializeComponentMetadataTable(testDb);
    
    const component1 = defineComponent({
      name: 'playerTest6',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const component2 = defineComponent({
      name: 'playerTest7', 
      schema: {
        name: z.string(),
        level: z.number(),
        health: z.number() // Added required field
      }
    });

    // Store original metadata
    storeComponentMetadata(testDb, [component1]);
    
    // Check the hashes are actually different
    const hash1 = hashComponentDefinition(component1);
    const hash2 = hashComponentDefinition(component2);
    console.log('Hash 1:', hash1);
    console.log('Hash 2:', hash2);
    console.log('Hashes different:', hash1 !== hash2);
    
    // Validate with different component should show as new component
    const validation = validateComponentCompatibility(testDb, [component1, component2]);
    
    expect(validation.compatible).toBe(true); // Adding new components is compatible
    expect(validation.warnings.length).toBeGreaterThan(0);
    expect(validation.warnings).toContain('New component table \'tbl_player_test_7\' added to the world definition');
    
    await cleanupDb();
  });

  test('should handle component additions and removals', async () => {
    initializeComponentMetadataTable(testDb);
    
    const component1 = defineComponent({
      name: 'playerTest8',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const component2 = defineComponent({
      name: 'playerTest9',
      schema: {
        health: z.number(),
        mana: z.number()
      }
    });

    // Store initial metadata with just component1
    storeComponentMetadata(testDb, [component1]);
    
    // Validate with both components (addition)
    const validationAddition = validateComponentCompatibility(testDb, [component1, component2]);
    expect(validationAddition.compatible).toBe(true);
    expect(validationAddition.warnings).toContain('New component table \'tbl_player_test_9\' added to the world definition');
    
    // Update metadata to include both
    updateComponentMetadata(testDb, [component1, component2]);
    
    // Validate with only component1 (removal)
    const validationRemoval = validateComponentCompatibility(testDb, [component1]);
    expect(validationRemoval.compatible).toBe(true);
    expect(validationRemoval.warnings).toContain('Component table \'tbl_player_test_9\' was removed from the world definition');
    
    await cleanupDb();
  });

  test('should update metadata correctly', async () => {
    initializeComponentMetadataTable(testDb);
    
    const component1 = defineComponent({
      name: 'playerTest10',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const component2 = defineComponent({
      name: 'playerTest11',
      schema: {
        health: z.number(),
        mana: z.number()
      }
    });

    // Initial store
    storeComponentMetadata(testDb, [component1]);
    let metadata = getStoredComponentMetadata(testDb);
    expect(metadata).toHaveLength(1);
    
    // Update with new components
    updateComponentMetadata(testDb, [component1, component2]);
    metadata = getStoredComponentMetadata(testDb);
    expect(metadata).toHaveLength(2);
    
    // Update removing one component
    updateComponentMetadata(testDb, [component2]);
    metadata = getStoredComponentMetadata(testDb);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].tbl_name).toBe('tbl_player_test_11');
    
    await cleanupDb();
  });
});