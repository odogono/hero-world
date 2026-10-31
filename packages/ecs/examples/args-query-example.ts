import { defineComponent, s } from '@component';
import { createWorld } from '@world';

// Define components
const playerComponent = defineComponent({
  id: 'player',
  schema: {
    health: s.number(),
    level: s.number(),
    name: s.string()
  }
});

const enemyComponent = defineComponent({
  id: 'enemy',
  schema: {
    difficulty: s.number(),
    type: s.enum(['goblin', 'orc', 'dragon'])
  }
});

// Example demonstrating args functionality in where clauses
export const argsQueryExample = async () => {
  console.log('=== Args Query Example ===\n');

  // Create a world with components
  const world = await createWorld([playerComponent, enemyComponent]);

  // Create some players
  world.create({ player: { health: 100, level: 5, name: 'Alice' } });
  world.create({ player: { health: 150, level: 10, name: 'Bob' } });
  world.create({ player: { health: 200, level: 15, name: 'Charlie' } });
  world.create({ player: { health: 250, level: 20, name: 'Diana' } });

  // Create some enemies
  world.create({ enemy: { difficulty: 1, type: 'goblin' } });
  world.create({ enemy: { difficulty: 5, type: 'orc' } });
  world.create({ enemy: { difficulty: 10, type: 'dragon' } });
  world.create({ enemy: { difficulty: 2, type: 'goblin' } });

  // Flush to persist to database
  world.flush();

  console.log('1. Query players by level using args:');
  const highLevelPlayers = world.queryAll({
    args: [10],
    where: 'player_level >= ?1',
    with: ['player']
  });
  console.log(`  Found ${highLevelPlayers.length} high-level players:`);
  for (const entity of highLevelPlayers) {
    console.log(`    ${entity.player.name} (Level ${entity.player.level})`);
  }

  console.log('\n2. Query enemies by type using args:');
  const goblins = world.queryAll({
    args: ['goblin'],
    where: 'enemy_type = ?1',
    with: ['enemy']
  });
  console.log(`  Found ${goblins.length} goblins:`);
  for (const entity of goblins) {
    console.log(
      `    ${entity.enemy.type} (Difficulty ${entity.enemy.difficulty})`
    );
  }

  console.log('\n3. Query with multiple args:');
  const mediumDifficultyEnemies = world.queryAll({
    args: [3, 8],
    where: 'enemy_difficulty >= ?1 AND enemy_difficulty <= ?2',
    with: ['enemy']
  });
  console.log(
    `  Found ${mediumDifficultyEnemies.length} medium difficulty enemies:`
  );
  for (const entity of mediumDifficultyEnemies) {
    console.log(
      `    ${entity.enemy.type} (Difficulty ${entity.enemy.difficulty})`
    );
  }

  console.log('\n4. Query players with health range:');
  const healthyPlayers = world.queryAll({
    args: [120, 18],
    where: 'player_health > ?1 AND player_level < ?2',
    with: ['player']
  });
  console.log(`  Found ${healthyPlayers.length} healthy mid-level players:`);
  for (const entity of healthyPlayers) {
    console.log(
      `    ${entity.player.name} (Level ${entity.player.level}, Health ${entity.player.health})`
    );
  }

  console.log('\n5. Query with string pattern matching:');
  const playersWithA = world.queryAll({
    args: ['%a%'],
    where: 'player_name LIKE ?1',
    with: ['player']
  });
  console.log(`  Found ${playersWithA.length} players with "a" in their name:`);
  for (const entity of playersWithA) {
    console.log(`    ${entity.player.name}`);
  }

  console.log('\n6. Query with limit and args:');
  const topPlayers = world.queryAll({
    args: [5],
    limit: 2,
    where: 'player_level >= ?1',
    with: ['player']
  });
  console.log(`  Found top ${topPlayers.length} players (level 5+):`);
  for (const entity of topPlayers) {
    console.log(`    ${entity.player.name} (Level ${entity.player.level})`);
  }
};

// Run the example if this file is executed directly
if (import.meta.main) {
  argsQueryExample();
}
