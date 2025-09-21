/* eslint-disable no-console */

import { s } from '../src/component';

// Complete EDL example demonstrating atoms, inheritance, references, arrays, and errors
const main = async () => {
  const { createWorld, defineComponent, queryEntity } = await import('../src');
  const { EDLErrorCodes, EDLExecutionError, executeEDL } = await import(
    '../src/edl'
  );

  // Define components used by the EDL script
  const described = defineComponent({
    id: 'described',
    schema: {
      description: s.string(),
      name: s.string()
    }
  });

  const thing = defineComponent({
    id: 'thing',
    schema: {
      size: s.number(),
      weight: s.number()
    }
  });

  const container = defineComponent({
    id: 'container',
    schema: {
      capacity: s.number(),
      isClosed: s.boolean()
    }
  });

  const lockable = defineComponent({
    id: 'lockable',
    schema: {
      isLocked: s.boolean(),
      key: s.string()
    }
  });

  // Link component to demonstrate $name reference to entity id
  const link = defineComponent({
    id: 'link',
    schema: {
      targetId: s.int().optional().foreignKey('tbl_entity')
    }
  });

  // Array component for $name.comp.list.1 style references
  const stats = defineComponent({
    id: 'stats_array_example',
    schema: {
      items: s.array('int')
    }
  });

  const world = await createWorld([
    described,
    thing,
    container,
    lockable,
    link,
    stats
  ]);

  // EDL script demonstrating atoms, inheritance, references, and arrays
  const edl = `
# Atoms define reusable templates (not instantiated)
atom chest {
  described { name: "Chest" description: "A simple wooden chest." }
  thing { size: 10 weight: 20 }
  container { capacity: 50 is_closed: false }
}

# Entities can extend atoms and override/augment components
entity lockable_chest: chest {
  lockable { is_locked: true key: "bronze_key" }
  container { is_closed: true }
}

# Entities can reference other entities by name
entity child {
  link { target_id: $lockable_chest }
}

# Arrays in components and indexed reference paths
entity stats_source {
  stats_array_example { items: [5, 15, 25] }
}
entity stats_consumer {
  thing { size: $stats_source.stats_array_example.items.1 weight: 99 }
}
`;

  console.log('Executing EDL...');
  executeEDL(world, edl);
  console.log('EDL executed and flushed.');

  // Query and print a few results
  const lc = world.query({
    with: ['described', 'thing', 'container', 'lockable']
  })!;
  console.log('\nLockable Chest entity:');
  console.log('id:', lc.id);
  console.log('described:', lc.described);
  console.log('thing:', lc.thing);
  console.log('container:', lc.container);
  console.log('lockable:', lc.lockable);

  const child = world.query({ with: ['link'] })!;
  console.log('\nChild links to:', child.link.targetId);

  const statsConsumer = world.query({
    where: 'thing_weight = 99',
    with: ['thing']
  })!;
  console.log('\nStats consumer thing:', statsConsumer.thing);

  // Demonstrate error handling: unknown reference
  const badEdl = `entity bad { link { target_id: $missing_entity } }`;
  try {
    executeEDL(world, badEdl);
  } catch (error) {
    if (error instanceof EDLExecutionError) {
      console.log('\nCaught EDLExecutionError as expected:');
      console.log(
        'code:',
        error.code,
        'expected:',
        EDLErrorCodes.EDL_EXECUTION_ERROR
      );
      for (const sub of error.errors) {
        console.log('-', sub.message);
      }
    } else {
      console.error('Unexpected error type:', error);
    }
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
}
