import { useState } from 'preact/hooks';

import { createCharacter } from './api';

const ERRORS: Record<string, string> = {
  invalid_name:
    'A name starts with a letter and has up to 20 letters, digits, spaces, hyphens or apostrophes.',
  name_taken: 'Someone already goes by that name.'
};

/**
 * Chooses a Character's name. `choose` makes it; by default it asks the
 * server for one, and a Local World passes its own.
 */
export const NameForm = ({
  choose = createCharacter,
  onCreated
}: {
  choose?: (
    name: string
  ) => Promise<{ error: string; ok: false } | { ok: true }>;
  onCreated: () => void;
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const submit = async (event: Event) => {
    event.preventDefault();
    const result = await choose(name.trim());
    if (result.ok) {
      onCreated();
    } else {
      setError(ERRORS[result.error] ?? "That name didn't work.");
    }
  };

  return (
    <main class="card">
      <h1>Who are you?</h1>
      <p>Choose the name others will know you by.</p>
      <form onSubmit={submit}>
        <label>
          Name
          <input
            autoFocus
            name="name"
            onInput={e => setName(e.currentTarget.value)}
            required
            value={name}
          />
        </label>
        <button type="submit">Enter the world</button>
        {error && <p class="error">{error}</p>}
      </form>
    </main>
  );
};
