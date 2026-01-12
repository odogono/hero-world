// Simple WebSocket test client to verify gameplay
const ws = new WebSocket('ws://localhost:3974/ws');

ws.onopen = () => {
  console.log('✓ Connected to server');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data as string);
  console.log('← Server:', data);

  // Auto-respond to prompts
  if (data.data?.includes('username')) {
    console.log('→ Sending username: TestPlayer');
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'cmd', payload: 'TestPlayer' }));
    }, 100);
  } else if (data.data?.includes('Welcome, TestPlayer')) {
    console.log('→ Sending: look');
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'cmd', payload: 'look' }));
    }, 100);
  } else if (data.data?.includes('West of house')) {
    console.log('→ Sending: north');
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'cmd', payload: 'north' }));
    }, 100);
  } else if (data.data?.includes('north side')) {
    console.log('→ Sending: south');
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'cmd', payload: 'south' }));
    }, 100);
  } else if (data.data?.includes('south side')) {
    console.log('✓ All tests passed!');
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 100);
  }
};

ws.onerror = (error) => {
  console.error('✗ WebSocket error:', error);
  process.exit(1);
};

ws.onclose = () => {
  console.log('✓ Connection closed');
};

// Timeout after 10 seconds
setTimeout(() => {
  console.error('✗ Test timeout');
  ws.close();
  process.exit(1);
}, 10000);
