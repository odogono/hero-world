import { createEcsTalk } from 'ecs-talk';
import { createGameLoop } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { EDLParseError } from 'odgn-ecs/edl';
import { type GameLoop } from 'odgn-ecs/system';
import type { EntityId } from 'odgn-ecs/types';
import { createWorld, type World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { defs, type MuaComponents } from './coms';
import { getEntity } from './queries/entity';
import { findConnectionByWsId, findPlayerByConnection } from './queries/player';
import { loadScripts } from './scripts/load';
import {
  NO_SCRIPTS,
  createScriptRunner,
  type ScriptRunner
} from './scripts/runner';
import { tell } from './systems/output';
import { expandExits } from './world/exits';
import {
  createLifecycle,
  recordHomes,
  type Lifecycle
} from './world/lifecycle';
import { ensurePlaces, type Places } from './world/places';

const log = createLog('mua-world');

/** How often the game loop ticks. A command is answered within one tick. */
const TICK_MS = 100;

/**
 * The most extra passes one tick runs while Scripts keep answering. Each
 * Script a command is offered to needs one, so this bounds a tick's work.
 */
const MAX_PASSES_PER_TICK = 10;

type MuaWorldOptions = {
  mainEDL?: string;
};

export class MuaWorld {
  world: World<MuaComponents> | null = null;
  options: MuaWorldOptions;
  loop: GameLoop<MuaComponents> | null = null;
  updateLoopInterval: ReturnType<typeof setInterval> | null = null;
  lastUpdateTime: number = 0;
  private scripts: ScriptRunner = NO_SCRIPTS;
  places: Places | null = null;
  lifecycle: Lifecycle | null = null;
  private isTicking = false;
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
        this.world.executeEDL(mainEDL, { path: mainPath });
      } catch (error) {
        if (error instanceof EDLParseError) {
          const msg = `${error.message}\nFile: ${mainPath}`;
          throw new EDLParseError(msg, { file: mainPath });
        }
        throw error;
      }
      log.info(`Loaded main EDL from ${mainPath}`);
      expandExits(this.world);
    }
    this.places = ensurePlaces(this.world);
    recordHomes(this.world);

    // under `bun test`, a system's error fails the test that caused it
    this.loop = createGameLoop(this.world, {
      throwErrors: process.env.NODE_ENV === 'test'
    });

    // NorthTalk Scripts, attached to atoms by their EDL `script` component
    const ecsTalk = createEcsTalk(this.world);
    const scriptedAtoms = await loadScripts(this.world, ecsTalk);
    const scripts = createScriptRunner(this.world, ecsTalk, scriptedAtoms);
    this.scripts = scripts;
    this.lifecycle = createLifecycle(this.world, scripts, this.places);

    // Import and register game systems
    const { inputSystem } = await import('./systems/inputSystem');
    const { parseSystem } = await import('./systems/parseSystem');
    const { createActionSystem } = await import('./systems/actionSystem');
    const { showSystem } = await import('./systems/showSystem');
    const { createOutputSystem } = await import('./systems/outputSystem');

    // Each system's priority sets its order: highest runs first. The Script
    // Group's Pump runs last; `tick` runs extra passes for its replies.
    this.loop.addSystem('input', inputSystem);
    this.loop.addSystem('parse', parseSystem);
    this.loop.addSystem('action', createActionSystem(scripts));
    this.loop.addSystem('show', showSystem);
    this.loop.addSystem('output', createOutputSystem(this.connections));
    this.loop.addSystem('talk', ecsTalk.system);

    // Scripts hear `start` in the first tick
    this.lifecycle.start();

    // Start the update loop
    this.lastUpdateTime = performance.now();
    this.updateLoopInterval = setInterval(() => {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastUpdateTime;
      this.lastUpdateTime = currentTime;
      this.tick(deltaTime).catch(error => {
        log.error('Tick failed', error);
      });
    }, TICK_MS);

    log.info(`Started update loop running every ${TICK_MS}ms`);
  }

  /**
   * Runs one tick: a pass of the game loop, then further passes for as long
   * as Scripts keep answering, so a command offered to several Scripts is
   * still answered within the tick. A Script that never answers costs nothing.
   */
  async tick(deltaTime: number) {
    if (!this.loop || this.isTicking) {
      return;
    }
    this.isTicking = true;
    try {
      this.loop.update(deltaTime);
      // a pass after an answer may raise events (such as a `show`), so run
      // one more pass after the last one that saw an answer
      let wasAnswered = false;
      for (let pass = 0; pass < MAX_PASSES_PER_TICK; pass++) {
        const before = this.scripts.settled();
        // Script replies settle once the Pump's promises run
        await Bun.sleep(0);
        const isAnswered = this.scripts.settled() !== before;
        if (!isAnswered && !wasAnswered) {
          break;
        }
        wasAnswered = isAnswered;
        this.loop.update(0);
      }
    } finally {
      this.isTicking = false;
    }
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

  getContents(locationId: EntityId) {
    return this.world?.queryAll({
      args: [locationId],
      where: 'location.in = ?1',
      with: ['location', 'described']
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

        player = this.world!.create({
          container: {
            capacity: 10,
            isClosed: false
          },
          ...(startRoom ? { location: { in: startRoom.id } } : {}),
          player: {
            connectedId: connectionEntity.id,
            name: username
          }
        });
        log.debug('Player created', player?.id);
      } else {
        player.player.connectedId = connectionEntity.id;
        this.bringBack(player.id);
        log.debug('Player reconnected', player.id);
      }

      // Mark as authenticated and remove authenticating
      connectionEntity.authenticated = {
        authenticatedAt: new Date()
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
      if (text === undefined) {
        log.warn('Command without text', conn.id);
        return true;
      }

      // Create input event
      this.world?.create({
        inputEvent: {
          text,
          timestamp: new Date(),
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
      connected: { connectedAt: new Date(), wsId: conn.id }
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
    const player =
      this.world && findPlayerByConnection(this.world, conn.id, true);

    if (player) {
      player.player.connectedId = undefined;
      this.world?.flush();
      this.sendToLimbo(player.id);
    }

    // the connection is gone: forget it, so its id can't be mistaken later
    const connection = this.world && findConnectionByWsId(this.world, conn.id);
    if (connection) {
      this.world?.delete(connection);
      this.world?.flush();
    }

    return true;
  }

  /** A player who leaves waits in Limbo, out of the world */
  private sendToLimbo(playerId: EntityId) {
    const world = this.world;
    const limbo = this.places?.limbo;
    const player =
      world && getEntity(world, playerId, ['location', 'player'], true);
    if (!world || limbo === undefined || !player) {
      return;
    }
    const room = player.location.in ?? undefined;
    if (room === undefined || room === limbo) {
      return;
    }
    player.player = { ...player.player, returnTo: room };
    player.location = { in: limbo };
    world.flush();
    tell(world, room, `${player.player.name} fades from view.`);
  }

  /** A player who comes back returns to where they left */
  private bringBack(playerId: EntityId) {
    const world = this.world;
    const player =
      world && getEntity(world, playerId, ['location', 'player'], true);
    const room = player?.player.returnTo ?? undefined;
    if (
      !world ||
      !player ||
      room === undefined ||
      player.location.in !== this.places?.limbo
    ) {
      return;
    }
    player.location = { in: room };
    player.player = { ...player.player, returnTo: undefined };
    world.flush();
    tell(world, room, `${player.player.name} appears.`, { exclude: playerId });
  }

  /** Puts a place's strayed things back (see world/lifecycle.ts) */
  resetPlace(placeId: EntityId) {
    return this.lifecycle?.reset(placeId) ?? 0;
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
