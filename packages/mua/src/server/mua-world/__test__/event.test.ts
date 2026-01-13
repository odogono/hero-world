import { describe } from 'bun:test';
import type { EntityId } from 'odgn-ecs/types';


type MuaEvent = {
  actor: EntityId;
  args: any[];
  target: EntityId;
  verb: string;
};

describe('Events', () => {
  // it('should excel at creating events', async () => {
  //   const muaWorld = new MuaWorld();
  //   await muaWorld.open();
  //   // retrieve all the containers
  //   const containers = muaWorld.world?.queryAll({
  //     with: ['container', 'described']
  //   });
  //   console.log(
  //     'containers:',
  //     containers?.map(c => c.described.name)
  //   );
  //   const westOfHouse = muaWorld.world?.query({
  //     with: ['described', 'meta'],
  //     where: 'meta.props.id = ?1',
  //     args: ['west_of_house']
  //   });
  //   console.log('westOfHouse:', westOfHouse?.described.name);
  //   const contents = muaWorld.getContents(westOfHouse!.id);
  //   console.log(
  //     'contents:',
  //     contents?.map(c => c.described.name)
  //   );
  //   // const dump = muaWorld.world?.db.dump();
  //   // console.log('dump:', dump);
  // });
});

/*

> Command Flow

  - Input thread in server/Connection.java:258-304 reads each line from the player's socket and invokes the abstract processInput, which is implemented by User.
  - server/User.java:138-185 logs the timing, strips any server CLI prefix, resolves the active channel, and forwards the bare command to that channel so gameplay input stays isolated from session commands.

  Parsing & Event Dispatch

  - The MUA channel (mua/apps/MuaApp.java:269-273) grabs the controlled avatar and calls world.parseCommand, using a per-user Parser.
  - mua/World.java:376-394 delegates to Parser.parseSentence; the parser pipeline (mua/parser/Parser.java:134-343) tokenises “look”, matches the verb template defined in the vocabulary (mua/scripts/verbs) to the look property, and posts a ParserEvent to the world event queue.
  - The event queue drains via mua/EventProcessor.java:32-152, which binds the event (through BinderEnumeration) and offers container/argument variants before letting World.callEvent execute the final bound event (mua/World.java:520-574). The root atom is configured to handle look by wiring it to the LookRoom action (mua/scripts/inner_core:51).

  Look Action Execution

  - LookRoom (mua/action/Look.java:424-479) overrides initCurrent so the current atom becomes the actor’s enclosing room, then builds an OutPkt labelled ROOM.
  - The shared container logic (mua/action/Look.java:239-361) walks visible contents, splits them into things, mobiles, and exits, annotates empty/closed states, and adds contextual fields such as place names and URLs before returning the packet.

  Output Delivery

  - The action sends the packet with actor.output(outpkt) (mua/action/Look.java:54-61); Thing.output expands it relative to the current event and hands it to the watcher chain (mua/atom/Thing.java:56-104).
  - The channel’s lead UserWatcher (mua/apps/MuaApp.java:298-312) relays the formatted text back through Channel.output (server/Channel.java:84-87), which routes via User.outputChannel (server/User.java:189-195) into the connection’s OutputQueue (server/Connection.java:229-384) and ultimately the socket writer, delivering the room description to the player’s client.

  Natural next step: if you want to see variant flows (examining objects, looking through exits, inventory), skim docs/look-command-flow.md for the broader coverage already checked in.

  */
