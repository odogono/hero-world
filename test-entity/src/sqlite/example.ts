import { object, number, string, boolean, iso, enum, array, record, unknown } from "zod";
import { zodSchemaToSqliteTable } from './schema-to-sql';

// Example 1: Basic user schema
const userSchema = object({
  id: number(),
  name: string(),
  email: string().email(),
  age: number().min(0).max(150).optional(),
  isActive: boolean().default(true),
  createdAt: iso.datetime(),
  updatedAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'users' });

console.log('=== User Table ===');
console.log(zodSchemaToSqliteTable(userSchema));

// Example 2: Product schema with different types
const productSchema = object({
  id: number(),
  name: string(),
  price: number().positive(),
  quantity: number().int().min(0),
  category: enum(['electronics', 'clothing', 'books']),
  tags: array(string()).optional(),
  metadata: record(string(), unknown()).optional(),
  createdAt: iso.datetime(),
}).meta({ name: 'products' });

console.log('\n=== Product Table ===');
console.log(zodSchemaToSqliteTable(productSchema));

// Example 3: Order schema with relationships
const orderSchema = object({
  id: number(),
  userId: number(),
  productId: number(),
  quantity: number().int().positive(),
  totalPrice: number().positive(),
  status: enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: object({
    street: string(),
    city: string(),
    state: string(),
    zipCode: string(),
    country: string(),
  }),
  createdAt: iso.datetime(),
  updatedAt: iso.datetime(),
}).meta({ name: 'orders' });

console.log('\n=== Order Table ===');
console.log(zodSchemaToSqliteTable(orderSchema));

// Example 4: Using options to override table name
console.log('\n=== Custom Table Name ===');
console.log(zodSchemaToSqliteTable(userSchema, { tableName: 'custom_users' }));

// Example: User and Post schemas with foreign key relationship
const userSchemaFK = object({
  id: number().meta({ primaryKey: true, autoIncrement: true }),
  name: string(),
  email: string().meta({ unique: true }),
  createdAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'tbl_users' });

const postSchemaFK = object({
  id: number().meta({ primaryKey: true, autoIncrement: true }),
  title: string(),
  content: string(),
  userId: number().meta({ foreignKey: 'tbl_users', cascade: true }),
  categoryId: number().meta({ foreignKey: 'tbl_categories' }),
  createdAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
  updatedAt: iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
}).meta({ name: 'tbl_posts' });

console.log('\n=== Foreign Key Example ===');
console.log('\nUser Table:');
const userTable = zodSchemaToSqliteTable(userSchemaFK);
console.log(userTable.sql);

console.log('\nPost Table (with foreign keys):');
const postTable = zodSchemaToSqliteTable(postSchemaFK);
console.log(postTable.sql);
