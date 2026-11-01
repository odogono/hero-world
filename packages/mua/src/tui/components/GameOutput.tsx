import { type GameMessage, type RoomData } from '../types';
import { MessageLine } from './MessageLine';

type GameOutputProps = {
  currentRoom: RoomData | null;
  messages: GameMessage[];
};

export const GameOutput = ({ currentRoom, messages }: GameOutputProps) => (
  <scrollbox
    focused
    style={{
      contentOptions: {
        backgroundColor: '#16161e'
      },
      rootOptions: {
        backgroundColor: '#24283b'
      },
      scrollbarOptions: {
        showArrows: true,
        trackOptions: {
          backgroundColor: '#414868',
          foregroundColor: '#7aa2f7'
        }
      },
      viewportOptions: {
        backgroundColor: '#1a1b26'
      },
      wrapperOptions: {
        backgroundColor: '#1f2335'
      }
    }}
  >
    {messages.length === 0 ? (
      <box
        style={{
          padding: 1,
          width: '100%'
        }}
      >
        <text content="Connecting to server..." />
      </box>
    ) : (
      messages.map(message => (
        <MessageLine
          key={message.id}
          message={message}
          roomData={currentRoom ?? undefined}
        />
      ))
    )}
  </scrollbox>
);
