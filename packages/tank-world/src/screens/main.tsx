import { createLog } from 'odgn-helpers';

import { ThemeTogglePortal } from '@components/theme/toggle-portal';

const log = createLog('Main');

const Main = () => {
  const message = 'ODGN Vite/React Starter';

  log.info(message);

  return (
    <>
      <div className="bg-background h-screen w-screen">
        <div className="flex h-full w-full items-center justify-center gap-4">
          <h1 className="text-text text-4xl">{message}</h1>
        </div>
      </div>
      <ThemeTogglePortal />
    </>
  );
};

export default Main;
