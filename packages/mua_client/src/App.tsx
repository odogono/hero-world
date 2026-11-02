import { useEffect } from 'preact/hooks';

import { NameForm } from './NameForm';
import { Play } from './Play';
import { SignIn } from './SignIn';
import { getSession, signOut } from './api';
import { connect } from './connection';
import { lines, session, status } from './store';

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
      lines.value = [];
      status.value = 'connecting';
      connect(token, characterId);
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
    session.value = null;
  };
  return <Play name={character.name} onLeft={left} />;
};
