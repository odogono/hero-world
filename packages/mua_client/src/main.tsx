import { render } from 'preact';

import { App } from './App';
import { currentSocket } from './connection';

import './styles.css';

render(<App />, document.getElementById('app')!);

// The browser checks cut the Connection through this, to test recovery
(window as unknown as { mua: unknown }).mua = { socket: currentSocket };
