import { JSCallback } from 'bun:ffi';

import {
  fromCString,
  loadLuaBindings,
  registerJSFunction,
  runLuaChunkReturnNumber,
  toCStringBuffer
} from './helpers';
import type { JSFunc } from './types';

type LuaResult<T> = T extends void ? void : T;

export const runLuaWithJSFunction = <
  T extends number | string | boolean | void
>(
  name: string,
  fn: JSFunc,
  code: string,
  luaLibPath?: string | null
): LuaResult<T> => {
  const lib = loadLuaBindings(luaLibPath);
  const L = lib.symbols.luaL_newstate();
  if (!L) {
    throw new Error('luaL_newstate failed');
  }
  let cb: JSCallback | null = null;
  try {
    lib.symbols.luaL_openlibs(L);
    cb = registerJSFunction(lib, L, name, fn);
    const buf = toCStringBuffer(code);
    const loadStatus = lib.symbols.luaL_loadstring(L, buf as unknown as string);
    if (loadStatus !== 0) {
      const msg = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`luaL_loadstring failed: ${msg}`);
    }
    const rc = lib.symbols.lua_pcallk(L, 0, 1, 0, 0, 0);
    if (rc !== 0) {
      const err = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`lua_pcall failed: ${err}`);
    }
    const LUA_TNUMBER = 3;
    const LUA_TBOOLEAN = 1;
    const LUA_TSTRING = 4;
    const t = lib.symbols.lua_type(L, -1);
    if (t === LUA_TNUMBER) {
      return lib.symbols.lua_tonumberx(L, -1, 0) as unknown as LuaResult<T>;
    }
    if (t === LUA_TBOOLEAN) {
      return (lib.symbols.lua_toboolean(L, -1) !==
        0) as unknown as LuaResult<T>;
    }
    if (t === LUA_TSTRING) {
      return fromCString(
        lib.symbols.lua_tolstring(L, -1, 0)
      ) as unknown as LuaResult<T>;
    }
    return undefined as LuaResult<T>;
  } finally {
    try {
      cb?.close();
    } catch {
      /* ignore callback close errors */
    }
    lib.symbols.lua_close(L);
  }
};

export const runLuaChunkReturnString = (
  code: string,
  luaLibPath?: string | null
): string => {
  const lib = loadLuaBindings(luaLibPath);
  const L = lib.symbols.luaL_newstate();
  if (!L) {
    throw new Error('luaL_newstate failed');
  }
  try {
    lib.symbols.luaL_openlibs(L);
    const buf = toCStringBuffer(code);
    const loadStatus = lib.symbols.luaL_loadstring(L, buf as unknown as string);
    if (loadStatus !== 0) {
      const msg = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`luaL_loadstring failed: ${msg}`);
    }
    const rc = lib.symbols.lua_pcallk(L, 0, 1, 0, 0, 0);
    if (rc !== 0) {
      const err = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`lua_pcall failed: ${err}`);
    }
    const LUA_TSTRING = 4;
    if (lib.symbols.lua_type(L, -1) !== LUA_TSTRING) {
      throw new Error('Expected Lua to return a string');
    }
    return fromCString(lib.symbols.lua_tolstring(L, -1, 0));
  } finally {
    lib.symbols.lua_close(L);
  }
};

export const runLuaChunkReturnObject = (
  code: string,
  luaLibPath?: string | null
): Record<string, string | number | boolean> => {
  const lib = loadLuaBindings(luaLibPath);
  const L = lib.symbols.luaL_newstate();
  if (!L) {
    throw new Error('luaL_newstate failed');
  }
  try {
    lib.symbols.luaL_openlibs(L);
    const buf = toCStringBuffer(code);
    const loadStatus = lib.symbols.luaL_loadstring(L, buf as unknown as string);
    if (loadStatus !== 0) {
      const msg = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`luaL_loadstring failed: ${msg}`);
    }
    const rc = lib.symbols.lua_pcallk(L, 0, 1, 0, 0, 0);
    if (rc !== 0) {
      const err = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
      throw new Error(`lua_pcall failed: ${err}`);
    }
    const LUA_TTABLE = 5;
    const LUA_TNUMBER = 3;
    const LUA_TBOOLEAN = 1;
    const LUA_TSTRING = 4;
    if (lib.symbols.lua_type(L, -1) !== LUA_TTABLE) {
      throw new Error('Expected Lua to return a table');
    }
    const result: Record<string, string | number | boolean> = {};
    // push nil to start iteration; table is at -1
    lib.symbols.lua_pushnil(L);
    while (lib.symbols.lua_next(L, -2) !== 0) {
      // now at ... table, key, value
      const keyType = lib.symbols.lua_type(L, -2);
      if (keyType === LUA_TSTRING) {
        const key = fromCString(lib.symbols.lua_tolstring(L, -2, 0));
        const valType = lib.symbols.lua_type(L, -1);
        if (valType === LUA_TSTRING) {
          result[key] = fromCString(lib.symbols.lua_tolstring(L, -1, 0));
        } else if (valType === LUA_TNUMBER) {
          result[key] = lib.symbols.lua_tonumberx(L, -1, 0);
        } else if (valType === LUA_TBOOLEAN) {
          result[key] = lib.symbols.lua_toboolean(L, -1) !== 0;
        }
      }
      // pop value, keep key for next iteration
      lib.symbols.lua_settop(L, -2);
    }
    return result;
  } finally {
    lib.symbols.lua_close(L);
  }
};
// If invoked directly: run a small demo
/* eslint-disable no-console -- CLI demo output when run as a script */
if (import.meta.main) {
  const code = 'return 10 + 32';
  try {
    const result = runLuaChunkReturnNumber(code);
    console.log(`[FFI] Lua result:`, result);
  } catch (error) {
    console.error(String(error));
    console.error(
      'Hint: install Lua (e.g., brew install lua) and/or set LUA_LIB_PATH to the liblua path.'
    );
    process.exit(1);
  }
}
/* eslint-enable no-console */
