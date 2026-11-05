import { DatabaseType } from 'odgn-ecs/db';
import { createWorld } from 'odgn-ecs/world';

import { components } from '../components';

const BASE = `
entity words {
  words {
    directions: [
      { name: "north" opposite: "south" }
      { name: "south" opposite: "north" }
      { name: "up" opposite: "down" }
      { name: "down" opposite: "up" }
    ]
    aliases: { n: "north" }
    articles: ["the"]
  }
  verbs {
    defs: [
      { names: ["take"] forms: [{ handler: "take" pattern: "obj" }] }
    ]
  }
}
`;

/** A mua World built from `edl`, with a few Directions and `take` */
export const buildWorld = async (edl: string) => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(BASE + edl);
  world.flush();
  const names = world.getDefinitionNames();
  return { id: (name: string) => names.get(name)!, store: world.store };
};
