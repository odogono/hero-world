/* eslint-disable no-console */
import { Database } from 'bun:sqlite';
import { boolean, date, number, object, string, z } from 'zod';

import { pkWithAutoIncrement, withIndex } from '@schema';
import {
  zodSchemaToSqliteIndexes,
  zodSchemaToSqliteInsert,
  zodSchemaToSqliteSchema,
  zodSchemaToSqliteSelect,
  zodSchemaToSqliteTable
} from '@schema/schema-to-sql';

/**
 * Example demonstrating SQLite index creation from Zod schemas
 */

// Example 1: Single-column indexes using field metadata
const userSchema = object({
  age: number(),
  createdAt: date(),
  email: string().meta({
    index: true, // Create an index on this field
    unique: true // Also make it unique
  }),
  firstName: string().meta({
    index: true, // Create an index on this field
    indexUnique: true // Make the index unique
  }),
  id: pkWithAutoIncrement(),
  lastName: string(),
  username: string().meta({
    index: true, // Create an index on this field
    indexName: 'idx_users_username' // Custom index name
  })
}).meta({ name: 'tbl_users' });

// Example 2: Composite indexes using schema metadata
const postSchema = object({
  categoryId: number().meta({ foreignKey: 'tbl_categories' }),
  content: string(),
  createdAt: date(),
  id: pkWithAutoIncrement(),
  publishedAt: date().optional(),
  status: z.enum(['draft', 'published', 'archived']),
  title: string(),
  updatedAt: date(),
  userId: number().meta({
    foreignKey: 'tbl_users',
    index: true // Single-column index
  })
}).meta({
  indexes: [
    // Composite index for user posts
    {
      columns: ['userId', 'status'],
      name: 'idx_posts_user_status'
    },
    // Unique composite index for category and status
    {
      columns: ['categoryId', 'status'],
      name: 'idx_posts_category_status_unique',
      unique: true
    },
    // Index for search by title and status
    {
      columns: ['title', 'status'],
      name: 'idx_posts_title_status'
    },
    // Index for date-based queries
    {
      columns: ['publishedAt', 'createdAt'],
      name: 'idx_posts_dates'
    }
  ],
  name: 'tbl_posts'
});

// Example 3: E-commerce schema with complex indexing
const productSchema = object({
  brandId: number().meta({ foreignKey: 'tbl_brands' }),
  categoryId: number().meta({ foreignKey: 'tbl_categories' }),
  createdAt: date(),
  id: number().meta({ autoIncrement: true, primaryKey: true }),
  isActive: boolean().meta({ index: true }),
  name: string().meta({ index: true }),
  price: number().meta({ index: true }),
  sku: string().meta({
    index: true,
    indexName: 'idx_products_sku',
    unique: true
  }),
  stockQuantity: number(),
  updatedAt: date()
}).meta({
  indexes: [
    // Search by category and price range
    {
      columns: ['categoryId', 'price'],
      name: 'idx_products_category_price'
    },
    // Search by brand and active status
    {
      columns: ['brandId', 'isActive'],
      name: 'idx_products_brand_active'
    },
    // Full-text search preparation (name + category)
    {
      columns: ['name', 'categoryId'],
      name: 'idx_products_name_category'
    },
    // Stock management
    {
      columns: ['stockQuantity', 'isActive'],
      name: 'idx_products_stock_active'
    }
  ],
  name: 'tbl_products'
});

export const demonstrateIndexCreation = () => {
  console.log('=== SQLite Index Creation from Zod Schemas ===\n');

  // Create in-memory database
  const db = new Database(':memory:');

  // Example 1: User schema with single-column indexes
  console.log('1. User Schema with Single-Column Indexes:');
  const userTableResult = zodSchemaToSqliteTable(userSchema);
  console.log('Table SQL:');
  console.log(userTableResult.sql);
  console.log('\nIndexes:');
  console.log(userTableResult.indexes);

  const userIndexes = zodSchemaToSqliteIndexes(userSchema);
  console.log('\nIndex SQL:');
  userIndexes.sql.forEach(sql => console.log(sql));
  console.log('\n');

  // Example 2: Post schema with composite indexes
  console.log('2. Post Schema with Composite Indexes:');
  const postTableResult = zodSchemaToSqliteTable(postSchema);
  console.log('Table SQL:');
  console.log(postTableResult.sql);
  console.log('\nIndexes:');
  console.log(postTableResult.indexes);

  const postIndexes = zodSchemaToSqliteIndexes(postSchema);
  console.log('\nIndex SQL:');
  postIndexes.sql.forEach(sql => console.log(sql));
  console.log('\n');

  // Example 3: Complete schema creation (table + indexes)
  console.log('3. Complete Schema Creation (Table + Indexes):');
  const completeSchema = zodSchemaToSqliteSchema(productSchema);
  console.log('Complete SQL Schema:');
  completeSchema.forEach((sql, index) => {
    console.log(`${index + 1}. ${sql}`);
  });
  console.log('\n');

  // Example 4: Database operations with indexes
  console.log('4. Database Operations with Indexes:');

  // Create tables and indexes
  db.exec(userTableResult.sql);
  userIndexes.sql.forEach(sql => db.exec(sql));

  // Insert data
  const insertUserSql = zodSchemaToSqliteInsert(userSchema);
  const insertUserStmt = db.query(insertUserSql);

  // Insert multiple users
  const users = [
    {
      age: 30,
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Doe',
      username: 'john_doe'
    },
    {
      age: 25,
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      username: 'jane_smith'
    },
    {
      age: 35,
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      username: 'bob_wilson'
    }
  ];

  users.forEach(user => {
    insertUserStmt.run(
      user.email,
      user.username,
      user.firstName,
      user.lastName,
      user.age,
      new Date().toISOString()
    );
  });

  // Query using indexed columns
  const selectSql = zodSchemaToSqliteSelect(userSchema) + ' WHERE email = ?';
  const selectStmt = db.query(selectSql);
  const user = selectStmt.get('john@example.com');

  console.log('Query result using indexed email column:');
  console.log(user);
  console.log('\n');

  // Example 5: Performance comparison (conceptual)
  console.log('5. Index Benefits:');
  console.log(
    '- Single-column indexes: Fast lookups by email, username, firstName'
  );
  console.log('- Composite indexes: Fast lookups by multiple columns');
  console.log('- Unique indexes: Enforce uniqueness and fast lookups');
  console.log('- Foreign key indexes: Fast joins between tables');
  console.log('\n');

  // Example 6: Index naming conventions
  console.log('6. Index Naming Conventions:');
  console.log('- Single-column: idx_{table}_{column}');
  console.log('- Composite: idx_{table}_{column1}_{column2}');
  console.log('- Custom names: Use indexName metadata');
  console.log('- Unique: Automatically handled by indexUnique flag');
};

export const demonstrateAdvancedIndexing = () => {
  console.log('=== Advanced Indexing Patterns ===\n');

  // Pattern 1: Time-series data indexing
  const timeSeriesSchema = object({
    id: pkWithAutoIncrement(),
    metric: withIndex(string()),
    source: string(),
    timestamp: withIndex(date()),
    value: number()
  }).meta({
    indexes: [
      // Time range queries
      { columns: ['timestamp', 'metric'] },
      // Source-based queries
      { columns: ['source', 'timestamp'] },
      // Value-based queries
      { columns: ['value', 'timestamp'] }
    ],
    name: 'tbl_metrics'
  });

  // Pattern 2: Multi-tenant indexing
  const multiTenantSchema = object({
    action: string(),
    createdAt: date(),
    id: pkWithAutoIncrement(),
    resourceId: number(),
    resourceType: withIndex(string()),
    tenantId: withIndex(number()),
    userId: withIndex(number())
  }).meta({
    indexes: [
      // Tenant isolation
      { columns: ['tenantId', 'createdAt'] },
      // User activity
      { columns: ['userId', 'tenantId', 'createdAt'] },
      // Resource tracking
      { columns: ['resourceType', 'resourceId', 'tenantId'] },
      // Action analysis
      { columns: ['action', 'tenantId', 'createdAt'] }
    ],
    name: 'tbl_audit_logs'
  });

  // Pattern 3: Search optimization
  const searchSchema = object({
    authorId: number().meta({ index: true }),
    category: string().meta({ index: true }),
    content: string(),
    id: pkWithAutoIncrement(),
    publishedAt: withIndex(date()),
    tags: withIndex(string()),
    title: withIndex(string()),
    viewCount: number()
  }).meta({
    indexes: [
      // Full-text search preparation
      { columns: ['title', 'category'] },
      // Tag-based search
      { columns: ['tags', 'publishedAt'] },
      // Author's articles
      { columns: ['authorId', 'publishedAt'] },
      // Popular articles
      { columns: ['viewCount', 'publishedAt'] },
      // Category popularity
      { columns: ['category', 'viewCount'] }
    ],
    name: 'tbl_articles'
  });

  console.log('Time-series indexing pattern:');
  const timeSeriesIndexes = zodSchemaToSqliteIndexes(timeSeriesSchema);
  timeSeriesIndexes.sql.forEach(sql => console.log(sql));
  console.log('\n');

  console.log('Multi-tenant indexing pattern:');
  const multiTenantIndexes = zodSchemaToSqliteIndexes(multiTenantSchema);
  multiTenantIndexes.sql.forEach(sql => console.log(sql));
  console.log('\n');

  console.log('Search optimization pattern:');
  const searchIndexes = zodSchemaToSqliteIndexes(searchSchema);
  searchIndexes.sql.forEach(sql => console.log(sql));
  console.log('\n');
};

// Run the examples
if (import.meta.main) {
  demonstrateIndexCreation();
  demonstrateAdvancedIndexing();
}
