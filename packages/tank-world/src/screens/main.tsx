import { createLog } from 'odgn-helpers';

import { ThemeTogglePortal } from '@components/theme/toggle-portal';
import { SQLiteDemo } from '@components/SQLiteDemo';
import { WSDemo } from '@components/WSDemo';

const log = createLog('Main');

const Main = () => {
  const message = 'ODGN Vite/React Starter';

  log.info(message);

  return (
    <>
      <div className="bg-background min-h-screen w-screen">
        <div className="flex flex-col items-center justify-center gap-8 py-8">
          <h1 className="text-text text-4xl">{message}</h1>
          <SQLiteDemo />
          <WSDemo />
        </div>
      </div>
      <ThemeTogglePortal />
    </>
  );
};

export default Main;
