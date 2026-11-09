import { useEffect, useState } from 'preact/hooks';

import { effect } from '@preact/signals';

import { NameForm } from './NameForm';
import { Play } from './Play';
import { SignIn } from './SignIn';
import { getSession, signOut } from './api';
import { connect, connectLocal } from './connection';
import {
  clearHistory,
  keepOnly,
  loadCommands,
  loadHistory,
  saveCommands,
  saveHistory
} from './history';
import { chooseName, offline, playOffline } from './offline';
import { Preview } from './preview/Preview';
import { commands, lines, session, status } from './store';
import { restored } from './transcript';

const refresh = async () => {
  session.value = await getSession();
};

// The page a hash names: `#preview` is the Admin Preview World (#243)
const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    addEventListener('hashchange', changed);
    return () => removeEventListener('hashchange', changed);
  }, []);
  return hash;
};

export const App = () => {
  const hash = useHash();
  useEffect(() => {
    void refresh();
  }, []);

  const current = session.value;
  const character = current?.characters[0];

  const token = current?.socket_token;
  const characterId = character?.id;

  useEffect(() => {
    if (token && characterId !== undefined) {
      keepOnly(characterId);
      lines.value = restored(loadHistory(characterId));
      commands.value = loadCommands(characterId);
      status.value = 'connecting';
      connect(token, characterId);
      const stopLines = effect(() => saveHistory(characterId, lines.value));
      const stopCommands = effect(() =>
        saveCommands(characterId, commands.value)
      );
      return () => {
        stopLines();
        stopCommands();
      };
    }
  }, [token, characterId]);

  const local = offline.value;
  useEffect(() => {
    if (local) {
      lines.value = [];
      commands.value = [];
      status.value = 'connecting';
      connectLocal(local);
    }
  }, [local]);

  if (local === null) {
    return <NameForm choose={chooseName} onCreated={() => {}} />;
  }
  if (local) {
    return (
      <Play
        admin={false}
        email={null}
        name={local}
        offline
        onLeft={() => {
          offline.value = undefined;
        }}
      />
    );
  }
  if (current === undefined) {
    return <main class="card">Loading…</main>;
  }
  if (current === null) {
    return <SignIn onOffline={playOffline} onSignedIn={refresh} />;
  }
  if (!character) {
    return <NameForm onCreated={refresh} />;
  }
  if (hash === '#preview' && current.admin) {
    // the Character stays connected underneath, to come back to
    return (
      <Preview
        onClose={() => {
          location.hash = '';
        }}
      />
    );
  }
  const left = async () => {
    await signOut();
    clearHistory();
    session.value = null;
  };
  return (
    <Play
      admin={current.admin}
      email={current.email ?? null}
      name={character.name}
      onLeft={left}
    />
  );
};
