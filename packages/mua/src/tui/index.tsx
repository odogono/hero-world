import { useCallback, useEffect, useRef, useState } from 'react';

import { createLog } from 'odgn-helpers/log';

import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';

import { CommandInput } from './components/CommandInput';
import { DebugPanel } from './components/DebugPanel';
import { GameOutput } from './components/GameOutput';
import { StatusBar } from './components/StatusBar';
import { useCommandHistory } from './hooks/use-command-history';
import { useDebugMode } from './hooks/use-debug-mode';
import { useGameState } from './hooks/use-game-state';
import { useWebSocket } from './hooks/use-websocket';
import { mask, unmask } from './utils/masked-input';
import { KNOWN_VERBS, completeVerb } from './utils/verb-completer';

const log = createLog('tui');

export const App = () => {
  const renderer = useRenderer();
  const [value, setValue] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'disconnected' | 'connecting'
  >('connecting');
  const [debugPanelVisible, setDebugPanelVisible] = useState(false);
  // the server's own verbs replace these once it sends them on login
  const [verbs, setVerbs] = useState<string[]>(KNOWN_VERBS);
  // the server asked for a password: mask it, and keep it out of the history
  const isPasswordNextRef = useRef(false);
  const [isMasked, setIsMasked] = useState(false);
  const passwordRef = useRef('');

  // Initialize hooks
  const gameState = useGameState();
  const commandHistory = useCommandHistory();
  const debugMode = useDebugMode();

  const { connect, disconnect, send } = useWebSocket(
    data => {
      // Handle incoming messages from server
      if (data && data.data) {
        gameState.addMessage(data.data, data.success ? 'game' : 'error');
      }
      // `look` sends the room as data too: prefer it to parsing the text
      isPasswordNextRef.current = data?.prompt === 'password';
      setIsMasked(isPasswordNextRef.current);
      passwordRef.current = '';
      if (data?.verbs) {
        setVerbs(data.verbs);
      }
      if (data?.room) {
        const { description, exits, items, name, players } = data.room;
        gameState.updateRoomData({
          description,
          exits,
          items,
          name,
          npcs: players
        });
      }
    },
    status => {
      // Handle connection status changes
      setConnectionStatus(status);
    }
  );

  const onSubmit = useCallback(
    (shown: string) => {
      const value = isPasswordNextRef.current ? passwordRef.current : shown;
      passwordRef.current = '';
      setIsMasked(false);
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }

      // CRITICAL FIX: Send correct message format for server
      send({ payload: trimmed, type: 'cmd' });

      // Add to command history, unless it was a password
      if (!isPasswordNextRef.current) {
        commandHistory.addCommand(trimmed);
      }
      isPasswordNextRef.current = false;

      // Clear input
      setValue('');
    },
    [send, commandHistory]
  );

  const handleHistoryPrevious = useCallback(() => {
    const prev = commandHistory.getPrevious();
    if (prev !== null) {
      setValue(prev);
    }
  }, [commandHistory]);

  const handleHistoryNext = useCallback(() => {
    const next = commandHistory.getNext();
    if (next !== null) {
      setValue(next);
    } else {
      setValue(''); // Clear input when reaching end of history
    }
  }, [commandHistory]);

  const handleTabComplete = useCallback(() => {
    const completed = completeVerb(value, verbs);
    if (completed) {
      setValue(completed);
    }
  }, [value, verbs]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      // a password shows only mask characters; the real text is kept aside
      if (isMasked) {
        passwordRef.current = unmask(passwordRef.current, newValue);
        setValue(mask(passwordRef.current));
        return;
      }
      setValue(newValue);
      // Reset history index when user types
      if (newValue !== value) {
        commandHistory.reset();
      }
    },
    [commandHistory, isMasked, value]
  );

  useKeyboard(key => {
    // Exit on ESC
    if (key.name === 'escape') {
      process.exit(0);
    }

    // Toggle console with Ctrl+K
    if (key.ctrl && key.name === 'k') {
      renderer?.toggleDebugOverlay();
      renderer?.console.toggle();
    }

    // Debug panel shortcuts
    if (key.ctrl && key.name === 'd') {
      setDebugPanelVisible(prev => !prev);
    }
    if (key.ctrl && key.name === 'r') {
      if (debugMode.isRecording) {
        debugMode.stopRecording();
      } else {
        debugMode.startRecording();
      }
    }
    if (key.ctrl && key.name === 'p') {
      debugMode.replay((cmd: string) => {
        send({ payload: cmd, type: 'cmd' });
      });
    }
    if (key.ctrl && key.name === 'c') {
      // Don't clear if it's the default Ctrl+C (exit)
      if (!key.meta && !key.shift) {
        debugMode.clear();
      }
    }

    // Command history navigation
    if (key.name === 'up') {
      handleHistoryPrevious();
    }
    if (key.name === 'down') {
      handleHistoryNext();
    }

    // Tab completion
    if (key.name === 'tab') {
      handleTabComplete();
    }
  });

  useEffect(() => {
    connect('ws://localhost:3974/ws');

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return (
    <box flexDirection="column" style={{ height: '100%' }}>
      <GameOutput
        currentRoom={gameState.currentRoom}
        messages={gameState.messages}
      />
      <StatusBar
        connectionStatus={connectionStatus}
        health={gameState.playerState.health}
        level={gameState.playerState.level}
        location={gameState.playerState.location}
      />
      <CommandInput
        onHistoryNext={handleHistoryNext}
        onHistoryPrevious={handleHistoryPrevious}
        onSubmit={onSubmit}
        onTabComplete={handleTabComplete}
        onValueChange={handleValueChange}
        value={value}
      />
      <DebugPanel
        debugState={debugMode}
        onClear={debugMode.clear}
        onRecord={debugMode.startRecording}
        onReplay={() => {
          debugMode.replay((cmd: string) => {
            send({ payload: cmd, type: 'cmd' });
          });
        }}
        onStop={debugMode.stopRecording}
        visible={debugPanelVisible}
      />
    </box>
  );
};

const renderer = await createCliRenderer();
const root = createRoot(renderer);
root.render(<App />);
