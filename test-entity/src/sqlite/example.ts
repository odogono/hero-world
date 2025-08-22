import * as z from "zod";
import { zodSchemaToSqliteTable } from './schema-to-sql';

// Example 1: Basic user schema
const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'users' });

console.log('=== User Table ===');
console.log(zodSchemaToSqliteTable(userSchema));

// Example 2: Product schema with different types
const productSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number().positive(),
  quantity: z.number().int().min(0),
  category: z.enum(['electronics', 'clothing', 'books']),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.iso.datetime(),
}).meta({ name: 'products' });

console.log('\n=== Product Table ===');
console.log(zodSchemaToSqliteTable(productSchema));

// Example 3: Order schema with relationships
const orderSchema = z.object({
  id: z.number(),
  userId: z.number(),
  productId: z.number(),
  quantity: z.number().int().positive(),
  totalPrice: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).meta({ name: 'orders' });

console.log('\n=== Order Table ===');
console.log(zodSchemaToSqliteTable(orderSchema));

// Example 4: Using options to override table name
console.log('\n=== Custom Table Name ===');
console.log(zodSchemaToSqliteTable(userSchema, { tableName: 'custom_users' }));

// Example: User and Post schemas with foreign key relationship
const userSchemaFK = z.object({
  id: z.number().meta({ primaryKey: true, autoIncrement: true }),
  name: z.string(),
  email: z.string().meta({ unique: true }),
  createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'tbl_users' });

const postSchemaFK = z.object({
  id: z.number().meta({ primaryKey: true, autoIncrement: true }),
  title: z.string(),
  content: z.string(),
  userId: z.number().meta({ foreignKey: 'tbl_users', cascade: true }),
  categoryId: z.number().meta({ foreignKey: 'tbl_categories' }),
  createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
  updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'tbl_posts' });

console.log('\n=== Foreign Key Example ===');
console.log('\nUser Table:');
const userTable = zodSchemaToSqliteTable(userSchemaFK);
console.log(userTable.sql);

console.log('\nPost Table (with foreign keys):');
const postTable = zodSchemaToSqliteTable(postSchemaFK);
console.log(postTable.sql);
