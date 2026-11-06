import { elements } from 'ecs-talk';
import { get, select, type Data, type Eid, type Store } from 'odgn-ecs/store';

/**
 * What a Character can see, for clients to show beside the text, as
 * `MuaWorld.View`: its room, what it carries and the commands it could type
 * next. It holds only what the Character could learn by looking, by name.
 */
export type View = {
  actions: string[];
  inventory: string[];
  room: {
    description: string;
    exits: string[];
    items: string[];
    name: string;
    players: string[];
  };
};

const READ = ['portal', 'item', 'container', 'player', 'npc', 'described'];

const entitiesIn = (store: Store, place: Eid) =>
  elements(store, place, { select: READ });

const nameOf = (data: Record<string, Data>) => {
  const name = (data.player ?? data.described)?.name;
  return typeof name === 'string' ? name : null;
};

/** The view for a Character in `room`, or null when it has no room to see */
export const viewFor = (
  store: Store,
  character: Eid,
  room: Eid | null
): View | null => {
  const described = room === null ? undefined : get(store, room, 'described');
  if (room === null || !described) {
    return null;
  }
  const contents = entitiesIn(store, room).filter(([e]) => e !== character);
  const exits = contents.flatMap(([, data]) =>
    data.portal ? [data.portal] : []
  );
  const doors = exits
    .map(p => p.door)
    .filter((door): door is number => typeof door === 'number');
  const closed = new Set(
    select(store, ['door'], {
      eids: doors,
      where: [['door', 'is_closed', true]]
    }).map(([e]) => e)
  );
  const things = contents.flatMap(([, data]) => {
    const name = nameOf(data);
    return (data.item || data.container) && name ? [{ data, name }] : [];
  });
  const carried = entitiesIn(store, character).flatMap(([, data]) => {
    const name = nameOf(data);
    return name ? [name] : [];
  });
  return {
    actions: [
      ...exits.map(p => p.dir as string),
      ...things
        .filter(({ data }) => data.item?.is_takeable === true)
        .map(({ name }) => `take ${name.toLowerCase()}`),
      ...carried.flatMap(n => [
        `examine ${n.toLowerCase()}`,
        `drop ${n.toLowerCase()}`
      ])
    ],
    inventory: carried,
    room: {
      description: described.description as string,
      exits: exits.map(p =>
        typeof p.door === 'number' && closed.has(p.door)
          ? `${String(p.dir)} (closed)`
          : String(p.dir)
      ),
      items: things.map(t => t.name),
      name: described.name as string,
      players: contents.flatMap(([, data]) => {
        const name = nameOf(data);
        return (data.player || data.npc) && name ? [name] : [];
      })
    }
  };
};
