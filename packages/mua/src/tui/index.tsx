import { useCallback, useEffect, useState } from 'react';

import { createLog } from 'odgn-helpers/log';

import { blue, bold, fg, red, t } from '@opentui/core';
import { render, useKeyboard, useRenderer } from '@opentui/react';

import { useWebSocket } from './hooks/use-websocket';

const log = createLog('tui');

export const App = () => {
  const renderer = useRenderer();
  const [value, setValue] = useState('');

  const { connect, disconnect, send } = useWebSocket();

  const onSubmit = useCallback(
    (value: string) => {
      send({ message: value });
      setValue('');
    },
    [send]
  );

  useKeyboard(key => {
    if (key.name === 'escape') {
      process.exit(0);
    }
    if (key.ctrl && key.name === 'k') {
      renderer?.toggleDebugOverlay();
      renderer?.console.toggle();
    }
  });

  useEffect(() => {
    connect('ws://localhost:3000/ws');
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return (
    <box flexDirection="column">
      <scrollbox
        height={10}
        style={{
          rootOptions: {
            backgroundColor: '#24283b'
          },
          wrapperOptions: {
            backgroundColor: '#1f2335'
          },
          viewportOptions: {
            backgroundColor: '#1a1b26'
          },
          contentOptions: {
            backgroundColor: '#16161e'
          },
          scrollbarOptions: {
            showArrows: true,
            trackOptions: {
              foregroundColor: '#7aa2f7',
              backgroundColor: '#414868'
            }
          }
        }}
        focused
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <box
            key={i}
            style={{
              width: '100%',
              padding: 1,
              marginBottom: 1,
              backgroundColor: i % 2 === 0 ? '#292e42' : '#2f3449'
            }}
          >
            <text content={`Box ${i}`} />
          </box>
        ))}
      </scrollbox>
      <box style={{ border: true, height: 3 }}>
        <input
          placeholder="Type here..."
          focused
          onInput={setValue}
          onSubmit={onSubmit}
          value={value}
        />
      </box>
    </box>
  );
};

render(<App />);
