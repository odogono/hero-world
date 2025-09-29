import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { EDLParseError } from 'odgn-ecs/edl';
import type { CDefWithSchema, EntityId } from 'odgn-ecs/types';
import { createWorld, type World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

const log = createLog('mua-world');

const containerDef = defineComponent({
  id: 'container',
  schema: {
    capacity: s.number().default(10),
    isClosed: s.boolean().default(false)
  }
});

const containedDef = defineComponent({
  id: 'contained',
  schema: {
    in: s.entityId().optional()
  }
});

const itemDef = defineComponent({
  id: 'item',
  schema: {
    weight: s.number().optional().default(1),
    isTakeable: s.boolean().default(true)
  }
});

const metaDef = defineComponent({
  id: 'meta',
  schema: {
    props: s.json().default({})
  }
});

const portalDef = defineComponent({
  id: 'portal',
  schema: {
    to: s.entityId().optional(),
    dir: s.string(),
    msg: s.string().optional()
  }
});

const describedDef = defineComponent({
  id: 'described',
  schema: {
    name: s.string(),
    description: s.string()
  }
});

const defs = [
  containerDef,
  metaDef,
  containedDef,
  portalDef,
  describedDef,
  itemDef
];

type MuaWorldOptions = {
  mainEDL?: string;
};

export class MuaWorld {
  world: World<any> | null = null;
  options: MuaWorldOptions;

  constructor(options: MuaWorldOptions = {}) {
    this.options = options;
  }

  async open() {
    const mainPath =
      this.options.mainEDL ?? 'src/server/mua-world/edl/main.edl';
    const mainFile = Bun.file(mainPath);
    const mainEDL = (await mainFile.exists()) ? await mainFile.text() : '';

    this.world = await createWorld(defs, {
      path: ':memory:',
      type: DatabaseType.BUN
    });

    this.world.open();

    if (mainEDL) {
      // load the edl from the file path
      // const dump = this.world.db.dump();
      // console.log(dump);
      try {
        this.world.executeEDL(mainEDL);
      } catch (err: any) {
        if (err instanceof EDLParseError) {
          const msg = `${err.message}\nFile: ${mainPath}`;
          throw new EDLParseError(msg, { file: mainPath });
        }
        throw err;
      }
      log.info(`Loaded main EDL from ${mainPath}`);
    }
  }

  async close() {
    await this.world?.close();
  }

  getContents(containedIn: EntityId) {
    return this.world?.queryAll({
      with: ['contained', 'described'],
      where: 'contained.in = ?1',
      args: [containedIn]
    });
  }

  onConnectionCommand(conn: MuaConnection, command: any) {
    log.debug('onConnectionCommand', conn.id, command);
    // this.world?.execute(command);

    return true;
  }

  onConnectionOpened(conn: MuaConnection) {
    log.debug('onConnectionOpened', conn.id);
    // this.world?.execute(`open ${id}`);

    return true;
  }

  onConnectionClosed(conn: MuaConnection) {
    log.debug('onConnectionClosed', conn.id);
    // this.world?.execute(`close ${id}`);

    return true;
  }
}

export type MuaConnection = {
  id: string;
  send: (data: string | BufferSource, compress?: boolean) => number;
};
