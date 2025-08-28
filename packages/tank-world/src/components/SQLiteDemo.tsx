import React, { useEffect, useState } from 'react';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

interface User {
  id: number;
  name: string;
  email: string;
}

export const SQLiteDemo: React.FC = () => {
  const [db, setDb] = useState<any>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '' });

  useEffect(() => {
    const initSQLite = async () => {
      try {
        const sqlite3 = await sqlite3InitModule({
          print: console.log,
          printErr: console.error,
        });

        console.log('SQLite3 initialized successfully');
        
        // Create database using the basic memory VFS
        const database = new sqlite3.oo1.DB();
        console.log('Database created successfully');
        
        try {
          // Create users table
          database.exec(`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE
            )
          `);
          console.log('Table created successfully');

          // Insert some sample data
          database.exec(`
            INSERT OR IGNORE INTO users (name, email) VALUES 
            ('Alice', 'alice@example.com'),
            ('Bob', 'bob@example.com'),
            ('Charlie', 'charlie@example.com')
          `);
          console.log('Sample data inserted successfully');

          setDb(database);
          loadUsers(database);
          setLoading(false);
          console.log('Component initialization completed successfully');
        } catch (dbError) {
          console.error('Database operation error:', dbError);
          throw dbError;
        }
      } catch (err) {
        console.error('SQLite initialization error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize SQLite');
        setLoading(false);
      }
    };

    initSQLite();

    return () => {
      if (db) {
        db.close();
      }
    };
  }, []);

  const loadUsers = (database: any) => {
    try {
      const stmt = database.prepare('SELECT * FROM users ORDER BY id');
      const userList: User[] = [];
      
      while (stmt.step()) {
        const row = stmt.get({});
        userList.push({
          id: row.id,
          name: row.name,
          email: row.email
        });
      }
      stmt.finalize();
      setUsers(userList);
      console.log('Loaded users:', userList);
    } catch (err) {
      console.error('Error loading users:', err);
      throw err;
    }
  };

  const addUser = () => {
    if (!db || !newUser.name || !newUser.email) return;

    try {
      const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
      stmt.bind([newUser.name, newUser.email]);
      stmt.step();
      stmt.finalize();

      loadUsers(db);
      setNewUser({ name: '', email: '' });
    } catch (err) {
      console.error('Error adding user:', err);
      setError(err instanceof Error ? err.message : 'Failed to add user');
    }
  };

  const deleteUser = (id: number) => {
    if (!db) return;

    try {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      stmt.bind([id]);
      stmt.step();
      stmt.finalize();

      loadUsers(db);
    } catch (err) {
      console.error('Error deleting user:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4">SQLite WASM Demo</h2>
        <p>Loading SQLite...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4">SQLite WASM Demo</h2>
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">SQLite WASM Demo</h2>
      
      <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded">
        <p className="text-sm text-green-700">
          ✅ SQLite WASM initialized successfully! This is running entirely in your browser with an in-memory database.
        </p>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Add New User</h3>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="Name"
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
          />
          <input
            type="email"
            placeholder="Email"
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
          />
          <button
            onClick={addUser}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Users ({users.length})</h3>
        {users.length === 0 ? (
          <p className="text-gray-500">No users found.</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded border"
              >
                <div>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-sm text-gray-600">{user.email}</div>
                </div>
                <button
                  onClick={() => deleteUser(user.id)}
                  className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <h4 className="font-semibold text-blue-800 mb-2">How it works:</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• SQLite WASM runs entirely in the browser</li>
          <li>• Database is stored in memory (not persistent)</li>
          <li>• Full SQL support with CREATE, INSERT, SELECT, DELETE</li>
          <li>• No server required - all operations are client-side</li>
        </ul>
      </div>
    </div>
  );
};