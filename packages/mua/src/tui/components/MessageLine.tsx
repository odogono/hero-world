import { type GameMessage, type RoomData } from '../types';
import { colorByType, colorizeMessage } from '../utils/color-utils';

type MessageLineProps = {
  message: GameMessage;
  roomData?: RoomData;
};

export const MessageLine = ({ message, roomData }: MessageLineProps) => {
  let displayContent = message.content;

  // Apply color coding based on room data (exits, items, npcs)
  if (roomData && message.type === 'game') {
    displayContent = colorizeMessage(message.content, roomData);
  }

  // Apply type-based coloring for errors/success
  if (message.type === 'error' || message.type === 'success' || message.type === 'system') {
    displayContent = colorByType(displayContent, message.type);
  }

  return (
    <box
      style={{
        marginBottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        width: '100%'
      }}
    >
      <text content={displayContent} />
    </box>
  );
};
