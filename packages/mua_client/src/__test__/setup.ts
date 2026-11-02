import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as { MUA_DEV?: boolean }).MUA_DEV = true;
