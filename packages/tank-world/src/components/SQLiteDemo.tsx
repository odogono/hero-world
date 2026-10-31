import React, { useEffect, useState } from 'react';

import { createLog } from 'odgn-helpers/log';

import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';

const log = createLog('sqlite-demo');

type User = {
  email: string;
  id: number;
  name: string;
};

export const SQLiteDemo: React.FC = () => {
  const [db, setDb] = useState<Database | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ email: '', name: '' });

  const loadUsers = (database: Database) => {
    try {
      const stmt = database.prepare('SELECT * FROM users ORDER BY id');
      const userList: User[] = [];

      while (stmt.step()) {
        const row = stmt.get({}) as User;
        userList.push({
          email: row.email,
          id: row.id,
          name: row.name
        });
      }
      stmt.finalize();
      setUsers(userList);
      log.info('Loaded users:', userList);
    } catch (error_) {
      log.error('Error loading users:', error_);
      throw error_;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let database: Database | undefined;

    const initSQLite = async () => {
      try {
        const sqlite3 = await sqlite3InitModule({
          print: log.info,
          printErr: log.error
        });

        log.info('SQLite3 initialized successfully');

        // Create database using the basic memory VFS
        database = new sqlite3.oo1.DB();
        if (cancelled) {
          database.close();
          return;
        }
        log.info('Database created successfully');

        try {
          // Create users table
          database.exec(`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE
            )
          `);
          log.info('Table created successfully');

          // Insert some sample data
          database.exec(`
            INSERT OR IGNORE INTO users (name, email) VALUES 
            ('Alice', 'alice@example.com'),
            ('Bob', 'bob@example.com'),
            ('Charlie', 'charlie@example.com')
          `);
          log.info('Sample data inserted successfully');

          setDb(database);
          loadUsers(database);
          setLoading(false);
          log.info('Component initialization completed successfully');
        } catch (dbError) {
          log.error('Database operation error:', dbError);
          throw dbError;
        }
      } catch (error_) {
        log.error('SQLite initialization error:', error_);
        setError(
          error_ instanceof Error
            ? error_.message
            : 'Failed to initialize SQLite'
        );
        setLoading(false);
      }
    };

    initSQLite();

    return () => {
      cancelled = true;
      database?.close();
    };
  }, []);

  const addUser = () => {
    if (!db || !newUser.name || !newUser.email) {
      return;
    }

    try {
      const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
      stmt.bind([newUser.name, newUser.email]);
      stmt.step();
      stmt.finalize();

      loadUsers(db);
      setNewUser({ email: '', name: '' });
    } catch (error_) {
      log.error('Error adding user:', error_);
      setError(error_ instanceof Error ? error_.message : 'Failed to add user');
    }
  };

  const deleteUser = (id: number) => {
    if (!db) {
      return;
    }

    try {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      stmt.bind([id]);
      stmt.step();
      stmt.finalize();

      loadUsers(db);
    } catch (error_) {
      log.error('Error deleting user:', error_);
      setError(
        error_ instanceof Error ? error_.message : 'Failed to delete user'
      );
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h2 className="mb-4 text-2xl font-bold">SQLite WASM Demo</h2>
        <p>Loading SQLite...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h2 className="mb-4 text-2xl font-bold">SQLite WASM Demo</h2>
        <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-6 text-2xl font-bold">SQLite WASM Demo</h2>

      <div className="mb-6 rounded border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-700">
          ✅ SQLite WASM initialized successfully! This is running entirely in
          your browser with an in-memory database.
        </p>
      </div>

      <div className="mb-6">
        <h3 className="mb-3 text-lg font-semibold">Add New User</h3>
        <div className="mb-2 flex gap-2">
          <input
            className="flex-1 rounded border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            onChange={e => setNewUser({ ...newUser, name: e.target.value })}
            placeholder="Name"
            type="text"
            value={newUser.name}
          />
          <input
            className="flex-1 rounded border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
            placeholder="Email"
            type="email"
            value={newUser.email}
          />
          <button
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            onClick={addUser}
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-semibold">Users ({users.length})</h3>
        {users.length === 0 ? (
          <p className="text-gray-500">No users found.</p>
        ) : (
          <div className="space-y-2">
            {users.map(user => (
              <div
                className="flex items-center justify-between rounded border bg-gray-50 p-3"
                key={user.id}
              >
                <div>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-sm text-gray-600">{user.email}</div>
                </div>
                <button
                  className="rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600 focus:ring-2 focus:ring-red-500 focus:outline-none"
                  onClick={() => deleteUser(user.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 rounded border border-blue-200 bg-blue-50 p-4">
        <h4 className="mb-2 font-semibold text-blue-800">How it works:</h4>
        <ul className="space-y-1 text-sm text-blue-700">
          <li>• SQLite WASM runs entirely in the browser</li>
          <li>• Database is stored in memory (not persistent)</li>
          <li>• Full SQL support with CREATE, INSERT, SELECT, DELETE</li>
          <li>• No server required - all operations are client-side</li>
        </ul>
      </div>
    </div>
  );
};
