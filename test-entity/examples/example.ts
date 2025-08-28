/* eslint-disable no-console */
import {
  array,
  boolean,
  iso,
  number,
  object,
  record,
  string,
  unknown,
  z as zod
} from 'zod';

import { zodSchemaToSqliteTable } from '@/schema/schema-to-sql';

// Example 1: Basic user schema
const userSchema = object({
  age: number().min(0).max(150).optional(),
  createdAt: iso.datetime(),
  email: string().email(),
  id: number(),
  isActive: boolean().default(true),
  name: string(),
  updatedAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' })
}).meta({ name: 'users' });

console.log('=== User Table ===');
console.log(zodSchemaToSqliteTable(userSchema));

// Example 2: Product schema with different types
const productSchema = object({
  category: zod.enum(['electronics', 'clothing', 'books']),
  createdAt: iso.datetime(),
  id: number(),
  metadata: record(string(), unknown()).optional(),
  name: string(),
  price: number().positive(),
  quantity: number().int().min(0),
  tags: array(string()).optional()
}).meta({ name: 'products' });

console.log('\n=== Product Table ===');
console.log(zodSchemaToSqliteTable(productSchema));

// Example 3: Order schema with relationships
const orderSchema = object({
  createdAt: iso.datetime(),
  id: number(),
  productId: number(),
  quantity: number().int().positive(),
  shippingAddress: object({
    city: string(),
    country: string(),
    state: string(),
    street: string(),
    zipCode: string()
  }),
  status: zod.enum([
    'pending',
    'processing',
    'shipped',
    'delivered',
    'cancelled'
  ]),
  totalPrice: number().positive(),
  updatedAt: iso.datetime(),
  userId: number()
}).meta({ name: 'orders' });

console.log('\n=== Order Table ===');
console.log(zodSchemaToSqliteTable(orderSchema));

// Example 4: Using options to override table name
console.log('\n=== Custom Table Name ===');
console.log(zodSchemaToSqliteTable(userSchema, { tableName: 'custom_users' }));

// Example: User and Post schemas with foreign key relationship
const userSchemaFK = object({
  createdAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
  email: string().meta({ unique: true }),
  id: number().meta({ autoIncrement: true, primaryKey: true }),
  name: string()
}).meta({ name: 'tbl_users' });

const postSchemaFK = object({
  categoryId: number().meta({ foreignKey: 'tbl_categories' }),
  content: string(),
  createdAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
  id: number().meta({ autoIncrement: true, primaryKey: true }),
  title: string(),
  updatedAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
  userId: number().meta({ cascade: true, foreignKey: 'tbl_users' })
}).meta({ name: 'tbl_posts' });

console.log('\n=== Foreign Key Example ===');
console.log('\nUser Table:');
const userTable = zodSchemaToSqliteTable(userSchemaFK);
console.log(userTable.sql);

console.log('\nPost Table (with foreign keys):');
const postTable = zodSchemaToSqliteTable(postSchemaFK);
console.log(postTable.sql);
