import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as { MUA_DEV?: boolean }).MUA_DEV = true;
(globalThis as { MUA_VERSION?: string }).MUA_VERSION = '0.0.0-test';
