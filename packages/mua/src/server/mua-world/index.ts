import { createGameLoop, defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { EDLParseError, serializeEntity } from 'odgn-ecs/edl';
import { createSystem, type GameLoop } from 'odgn-ecs/system';
import type { CDefWithSchema, EntityId } from 'odgn-ecs/types';
import { createWorld, type World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { defs } from './coms';

const log = createLog('mua-world');

type MuaWorldOptions = {
  mainEDL?: string;
};

export class MuaWorld {
  world: World<any> | null = null;
  options: MuaWorldOptions;
  loop: GameLoop<any> | null = null;
  updateLoopInterval: ReturnType<typeof setInterval> | null = null;
  lastUpdateTime: number = 0;

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

    // World is already opened and initialized by createWorld

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

    this.loop = createGameLoop(this.world);

    const authenticatingSystem = createSystem(
      ({ deltaTime, entity }) => {
        log.debug('deltaTime', deltaTime, serializeEntity(entity));
      },
      {
        frequency: 1,
        with: ['connected', 'authenticating']
      }
    );

    const updateSystem = createSystem(
      ({ deltaTime }) => {
        log.debug('Update loop 1 running - deltaTime:', deltaTime);
      },
      {
        frequency: 1,
        priority: 10
      }
    );

    // const updateSystem2 = this.world.createSystem(
    //   ({ deltaTime }) => {
    //     log.debug('Update loop 2 running - deltaTime:', deltaTime);
    //   },
    //   {
    //     frequency: 2,
    //     priority: 5
    //   }
    // );

    this.loop.addSystem('authenticating', authenticatingSystem);
    // this.loop.addSystem('update', updateSystem);
    // this.loop.addSystem('update2', updateSystem2);

    // Start the update loop that runs every second (1000ms)
    this.lastUpdateTime = performance.now();
    this.updateLoopInterval = setInterval(() => {
      if (this.loop) {
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastUpdateTime;
        this.lastUpdateTime = currentTime;
        this.loop.update(deltaTime);
      }
    }, 1000);

    log.info('Started update loop running every 1000');
  }

  async close() {
    // Stop the update loop
    if (this.updateLoopInterval) {
      clearInterval(this.updateLoopInterval);
      this.updateLoopInterval = null;
      log.info('Stopped update loop');
    }

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

    // get the connection entity
    const connectionEntity = this.world?.query({
      with: ['connected'],
      where: 'connected.ws_id = ?1',
      args: [conn.id]
    });

    if (!connectionEntity) {
      log.error('Connection entity not found', conn.id);
      // drop the connection
      conn.close();
      return false;
    }

    // this.world?.execute(command);

    return true;
  }

  onConnectionOpened(conn: MuaConnection) {
    log.debug('onConnectionOpened', conn.id);

    // create an entity with the connection component
    this.world?.create({
      connected: { wsId: conn.id },
      authenticating: { attempts: 0 }
    });

    // the server now expects an authentication message
    // from the client

    this.world?.flush();

    return true;
  }

  onConnectionClosed(conn: MuaConnection) {
    log.debug('onConnectionClosed', conn.id);

    return true;
  }
}

export type MuaConnection = {
  id: string;
  send: (data: string | BufferSource, compress?: boolean) => number;
  close: () => void;
};
