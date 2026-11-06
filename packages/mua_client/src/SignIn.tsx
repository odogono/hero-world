import { useState } from 'preact/hooks';

import { devSignIn } from './api';

export const SignIn = ({
  onOffline,
  onSignedIn
}: {
  onOffline: () => void;
  onSignedIn: () => void;
}) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();

  const submit = async (event: Event) => {
    event.preventDefault();
    if (await devSignIn(email)) {
      onSignedIn();
    } else {
      setError('That email is not on the list.');
    }
  };

  return (
    <main class="card">
      <h1>Mua</h1>
      <p>A world of words, shared with friends.</p>
      <a class="button" href="/auth/google">
        Sign in with Google
      </a>
      <p>
        Or play on your own, in this browser, without signing in. Your world is
        kept here, and nobody else can visit it.
      </p>
      <button onClick={onOffline} type="button">
        Play offline
      </button>
      {MUA_DEV && (
        <form aria-label="Development sign-in" onSubmit={submit}>
          <label>
            Email (development only)
            <input
              name="email"
              onInput={e => setEmail(e.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <button type="submit">Sign in</button>
          {error && <p class="error">{error}</p>}
        </form>
      )}
    </main>
  );
};
