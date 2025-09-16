import {
  createComponent,
  defineComponent,
  s,
  type InferComponentType
} from '@component';

// Define a component with schema
const userDef = defineComponent({
  id: 'user',
  schema: {
    age: s.float().default(25),
    email: s.email(),
    isActive: s.string().default('true'),
    name: s.string().default('John Doe')
  }
});

// Type inference works! The type is automatically inferred from the schema
type UserType = InferComponentType<typeof userDef>;
// This is equivalent to:
// type UserType = {
//   name: 'John Doe';
//   email: string;
//   age: 25;
//   isActive: 'true';
// }

// Create a component instance with type safety
const user = createComponent(userDef, {
  age: 30,
  email: 'john@example.com'
});

// TypeScript knows the exact types:
// user.name is 'John Doe' (from default)
// user.email is 'john@example.com' (from input)
// user.age is 30 (from input, overrides default)
// user.isActive is 'true' (from default)

console.log('User:', user);

// Backward compatibility: the old Infer type alias also works
type UserTypeOld = Infer<typeof userDef>;
// This is exactly the same as InferComponentType<typeof userDef>

export { userDef, user, type UserType, type UserTypeOld };
