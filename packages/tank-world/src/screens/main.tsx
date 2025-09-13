import { createLog } from 'odgn-helpers/log';

import { TankGame } from '@components/TankGame';
import { ThemeTogglePortal } from '@components/theme/toggle-portal';

const log = createLog('Main');

const Main = () => {
  log.info('Tank World - Main Screen');

  return (
    <>
      <div className="bg-background min-h-screen w-screen">
        <TankGame />
      </div>
      <ThemeTogglePortal />
    </>
  );
};

export default Main;
