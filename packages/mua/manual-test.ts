// Manual WebSocket test client
const ws = new WebSocket('ws://localhost:3974/ws');
let step = 0;

const commands = [
  'Hero', // username
  'look', // look around
  'north', // move north
  'south', // move back south
  'l' // look again (alias)
];

ws.onopen = () => {
  console.log('[Client] Connected\n');
};

ws.onmessage = (event) => {
  console.log('[Server] ←', event.data, '\n');

  // Send next command after a delay
  if (step < commands.length) {
    const cmd = commands[step];
    step++;
    setTimeout(() => {
      console.log('[Client] → Sending:', cmd);
      ws.send(JSON.stringify({ type: 'cmd', payload: cmd }));
    }, 2000); // Wait 2 seconds between commands to allow game loop to process
  } else {
    console.log('[Client] All commands sent, waiting for responses...');
  }
};

ws.onerror = (error) => {
  console.error('[Client] Error:', error);
};

ws.onclose = () => {
  console.log('[Client] Connection closed');
};

// Keep alive for 30 seconds
setTimeout(() => {
  console.log('[Client] Test complete, closing connection');
  ws.close();
  process.exit(0);
}, 30000);
