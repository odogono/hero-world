import { createLog } from 'odgn-helpers/log';

import { GameDemo } from '@components/GameDemo';
import { SQLiteDemo } from '@components/SQLiteDemo';
import { ThemeTogglePortal } from '@components/theme/toggle-portal';

const log = createLog('Main');

const Main = () => {
  const message = 'ODGN Vite/React Starter';

  log.info(message);

  return (
    <>
      <div className="bg-background min-h-screen w-screen">
        <div className="flex flex-col items-center justify-center gap-8 py-8">
          <h1 className="text-text text-4xl">{message}</h1>
          <GameDemo />
          <SQLiteDemo />
        </div>
      </div>
      <ThemeTogglePortal />
    </>
  );
};

export default Main;
