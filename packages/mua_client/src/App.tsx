import { useEffect } from 'preact/hooks';

import { effect } from '@preact/signals';

import { NameForm } from './NameForm';
import { Play } from './Play';
import { SignIn } from './SignIn';
import { getSession, signOut } from './api';
import { connect } from './connection';
import {
  clearHistory,
  keepOnly,
  loadCommands,
  loadHistory,
  saveCommands,
  saveHistory
} from './history';
import { commands, lines, session, status } from './store';
import { restored } from './transcript';

const refresh = async () => {
  session.value = await getSession();
};

export const App = () => {
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

  if (current === undefined) {
    return <main class="card">Loading…</main>;
  }
  if (current === null) {
    return <SignIn onSignedIn={refresh} />;
  }
  if (!character) {
    return <NameForm onCreated={refresh} />;
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
