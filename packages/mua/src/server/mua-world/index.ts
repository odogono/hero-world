import { createGameLoop } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { EDLParseError } from 'odgn-ecs/edl';
import { type GameLoop } from 'odgn-ecs/system';
import type { EntityId } from 'odgn-ecs/types';
import { createWorld, type World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { defs, type MuaComponents } from './coms';

const log = createLog('mua-world');

type MuaWorldOptions = {
  mainEDL?: string;
};

export class MuaWorld {
  world: World<MuaComponents> | null = null;
  options: MuaWorldOptions;
  loop: GameLoop<MuaComponents> | null = null;
  updateLoopInterval: ReturnType<typeof setInterval> | null = null;
  lastUpdateTime: number = 0;
  private connections = new Map<string, MuaConnection>();

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
      } catch (error) {
        if (error instanceof EDLParseError) {
          const msg = `${error.message}\nFile: ${mainPath}`;
          throw new EDLParseError(msg, { file: mainPath });
        }
        throw error;
      }
      log.info(`Loaded main EDL from ${mainPath}`);
    }

    this.loop = createGameLoop(this.world);

    // Import and register game systems
    const { inputSystem } = await import('./systems/inputSystem');
    const { parseSystem } = await import('./systems/parseSystem');
    const { actionSystem } = await import('./systems/actionSystem');
    const { createOutputSystem } = await import('./systems/outputSystem');

    // Register systems in priority order
    this.loop.addSystem('input', inputSystem);
    this.loop.addSystem('parse', parseSystem);
    this.loop.addSystem('action', actionSystem);
    this.loop.addSystem('output', createOutputSystem(this.connections));

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
      args: [containedIn],
      where: 'contained.in = ?1',
      with: ['contained', 'described']
    });
  }

  private async handleLogin(
    conn: MuaConnection,
    username: string
  ): Promise<boolean> {
    try {
      log.debug('handleLogin start', username);
      const connectionEntity = this.world?.query({
        args: [conn.id],
        asProxy: true,
        maybe: ['authenticating', 'authenticated'],
        where: 'connected.ws_id = ?1',
        with: ['connected']
      });

      if (!connectionEntity) {
        log.error('Connection entity not found for login', conn.id);
        return false;
      }

      // Find or create player
      const { findPlayerByName } = await import('./queries/player');
      const { findRoomByMetaId } = await import('./queries/room');

      let player = findPlayerByName(this.world!, username);
      log.debug('Found existing player?', !!player);

      if (!player) {
        const startRoom = findRoomByMetaId(this.world!, 'west_of_house');
        log.debug('Start room found?', !!startRoom, startRoom?.id);

        player = this.world?.create({
          container: {
            capacity: 10,
            isClosed: false
          },
          player: {
            connectedId: connectionEntity.id,
            location: startRoom?.id,
            name: username
          }
        });
        log.debug('Player created', player?.id);
      } else {
        player.player.connectedId = connectionEntity.id;
        log.debug('Player reconnected', player.id);
      }

      // Mark as authenticated and remove authenticating
      connectionEntity.authenticated = {
        authenticatedAt: new Date().toISOString()
      };
      // Remove authenticating by setting to undefined (null doesn't work)
      delete connectionEntity.authenticating;

      this.world?.flush();
      log.debug(
        'World flushed, authenticated:',
        !!connectionEntity.authenticated
      );

      // Send welcome message
      const message = `Welcome, ${username}! Type 'look' to begin.`;
      conn.send(
        JSON.stringify({
          data: message,
          success: true
        })
      );
      log.debug('Welcome message sent', message);

      return true;
    } catch (error) {
      log.error('Error in handleLogin', error);
      return false;
    }
  }

  onConnectionCommand(conn: MuaConnection, command: MuaCommand) {
    log.debug('onConnectionCommand', conn.id, command);

    const connectionEntity = this.world?.query({
      args: [conn.id],
      asProxy: true,
      maybe: ['authenticating', 'authenticated'],
      where: 'connected.ws_id = ?1',
      with: ['connected']
    });

    if (!connectionEntity) {
      log.error('Connection entity not found', conn.id);
      conn.close();
      return false;
    }

    log.debug(
      'Connection state',
      'authenticating:',
      !!connectionEntity.authenticating,
      'authenticated:',
      !!connectionEntity.authenticated
    );

    // Handle login if authenticating
    if (connectionEntity.authenticating && !connectionEntity.authenticated) {
      const username =
        typeof command === 'string'
          ? command
          : command.data?.username || command.username;
      log.debug('About to call handleLogin', username);
      // Fire and forget - don't await to keep the method synchronous
      this.handleLogin(conn, username as string).catch(error => {
        log.error('handleLogin error', error);
      });
      return true;
    }

    // Handle game commands if authenticated
    if (connectionEntity.authenticated) {
      const text = typeof command === 'string' ? command : command.text;

      // Create input event
      this.world?.create({
        inputEvent: {
          text,
          timestamp: new Date().toISOString(),
          wsId: conn.id
        }
      });

      this.world?.flush();
    } else {
      log.warn('Connection neither authenticating nor authenticated', conn.id);
    }

    return true;
  }

  onConnectionOpened(conn: MuaConnection) {
    log.debug('onConnectionOpened', conn.id);
    this.connections.set(conn.id, conn);

    // create an entity with the connection component
    this.world?.create({
      authenticating: { attempts: 0 },
      connected: { wsId: conn.id }
    });

    // the server now expects an authentication message
    // from the client

    this.world?.flush();

    return true;
  }

  onConnectionClosed(conn: MuaConnection) {
    log.debug('onConnectionClosed', conn.id);
    this.connections.delete(conn.id);

    // Unlink player from connection
    const player = this.world?.query({
      args: [conn.id],
      where: `player.connected_id IN (
        SELECT id FROM entity WHERE id IN (
          SELECT id FROM connected WHERE connected.ws_id = ?1
        )
      )`,
      with: ['player']
    });

    if (player) {
      player.player.connectedId = undefined;
      this.world?.flush();
    }

    return true;
  }
}

export type MuaCommand =
  | string
  | {
      data?: { password?: string; username?: string };
      text?: string;
      type?: string;
      username?: string;
    };

export type MuaConnection = {
  close: () => void;
  id: string;
  send: (data: string | BufferSource, compress?: boolean) => number;
};
