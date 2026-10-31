import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FFIType, JSCallback, dlopen } from 'bun:ffi';

import type { JSFunc, JSJsonish, LuaBindings } from './types';

export const resolveLuaLibPath = (): string | null => {
  const fromEnv = process.env.LUA_LIB_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  const candidates = [
    // macOS (Homebrew)
    '/opt/homebrew/opt/lua/lib/liblua.dylib',
    '/opt/homebrew/opt/lua@5.4/lib/liblua.5.4.dylib',
    '/usr/local/opt/lua/lib/liblua.dylib',
    '/usr/local/opt/lua@5.4/lib/liblua.5.4.dylib',
    // Linux
    '/usr/lib/x86_64-linux-gnu/liblua5.4.so',
    '/usr/lib64/liblua5.4.so',
    '/usr/local/lib/liblua5.4.so',
    '/usr/lib/liblua5.4.so',
    '/usr/lib/liblua5.4.so.0',
    '/usr/lib/liblua-5.4.so',
    '/usr/lib/liblua.so',
    // Windows (if running Bun on Windows)
    'C:/msys64/mingw64/bin/lua54.dll',
    'C:/Windows/System32/lua54.dll'
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        return p;
      }
    } catch {
      // ignore
    }
  }
  return null;
};

export const loadLuaBindings = (luaLibPath?: string | null): LuaBindings => {
  const path = luaLibPath ?? resolveLuaLibPath();
  if (!path) {
    throw new Error(
      'Lua shared library not found. Set LUA_LIB_PATH to your liblua path (e.g., /opt/homebrew/opt/lua/lib/liblua.dylib).'
    );
  }

  return dlopen(path, {
    lua_close: { args: [FFIType.ptr], returns: FFIType.void },
    luaL_loadstring: {
      args: [FFIType.ptr, FFIType.cstring],
      returns: FFIType.i32
    },
    luaL_newstate: { args: [], returns: FFIType.ptr },
    luaL_openlibs: { args: [FFIType.ptr], returns: FFIType.void },
    // lua_pcall may not be exported; lua_pcallk is available in 5.4
    lua_createtable: {
      args: [FFIType.ptr, FFIType.i32, FFIType.i32],
      returns: FFIType.void
    },
    lua_gettop: { args: [FFIType.ptr], returns: FFIType.i32 },
    lua_next: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    lua_pcallk: {
      args: [
        FFIType.ptr,
        FFIType.i32,
        FFIType.i32,
        FFIType.i32,
        FFIType.i32,
        FFIType.ptr
      ],
      returns: FFIType.i32
    },
    lua_pushboolean: {
      args: [FFIType.ptr, FFIType.i32],
      returns: FFIType.void
    },
    lua_pushcclosure: {
      args: [FFIType.ptr, FFIType.function, FFIType.i32],
      returns: FFIType.void
    },
    lua_pushnil: { args: [FFIType.ptr], returns: FFIType.void },
    lua_pushnumber: { args: [FFIType.ptr, FFIType.f64], returns: FFIType.void },
    lua_pushstring: {
      args: [FFIType.ptr, FFIType.cstring],
      returns: FFIType.void
    },
    lua_rawseti: {
      args: [FFIType.ptr, FFIType.i32, FFIType.i32],
      returns: FFIType.void
    },
    lua_setfield: {
      args: [FFIType.ptr, FFIType.i32, FFIType.cstring],
      returns: FFIType.void
    },
    lua_setglobal: {
      args: [FFIType.ptr, FFIType.cstring],
      returns: FFIType.void
    },
    lua_settop: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.void },
    lua_toboolean: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    lua_tolstring: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.cstring
    },
    lua_tonumberx: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.f64
    },
    lua_type: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 }
  }) as unknown as LuaBindings;
};

export const registerJSFunction = (
  lib: LuaBindings,
  L: number,
  name: string,
  fn: JSFunc
): JSCallback => {
  const cb = new JSCallback(
    (Lptr: number): number => {
      const LUA_TNUMBER = 3;
      const LUA_TBOOLEAN = 1;
      const LUA_TSTRING = 4;
      const argc = lib.symbols.lua_gettop(Lptr);
      const argv: Array<number | string | boolean> = [];
      for (let i = 1; i <= argc; i++) {
        const t = lib.symbols.lua_type(Lptr, i);
        if (t === LUA_TNUMBER) {
          argv.push(lib.symbols.lua_tonumberx(Lptr, i, 0));
        } else if (t === LUA_TBOOLEAN) {
          argv.push(lib.symbols.lua_toboolean(Lptr, i) !== 0);
        } else if (t === LUA_TSTRING) {
          argv.push(fromCString(lib.symbols.lua_tolstring(Lptr, i, 0)));
        } else {
          argv.push(undefined as unknown as never);
        }
      }
      const out = fn(argv);
      if (typeof out === 'number') {
        lib.symbols.lua_pushnumber(Lptr, out);
        return 1;
      } else if (typeof out === 'string') {
        const buf = toCStringBuffer(out);
        lib.symbols.lua_pushstring(Lptr, buf as unknown as string);
        return 1;
      } else if (typeof out === 'boolean') {
        lib.symbols.lua_pushboolean(Lptr, out ? 1 : 0);
        return 1;
      }
      return 0;
    },
    { args: ['ptr'], returns: 'i32' }
  );

  lib.symbols.lua_pushcclosure(L, cb.ptr as number, 0);
  const nbuf = toCStringBuffer(name);
  lib.symbols.lua_setglobal(L, nbuf as unknown as string);
  return cb;
};

// Encode a JavaScript string as a null-terminated UTF-8 C string buffer.
export const toCStringBuffer = (s: string): Uint8Array => {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = 0; // NUL terminator
  return out;
};

export const fromCString = (cstr: unknown): string =>
  typeof cstr === 'string' ? cstr : String(cstr);

export const luaToJSFromTop = (lib: LuaBindings, L: number): JSJsonish => {
  const LUA_TNIL = 0;
  const LUA_TBOOLEAN = 1;
  const LUA_TNUMBER = 3;
  const LUA_TSTRING = 4;
  const LUA_TTABLE = 5;
  const t = lib.symbols.lua_type(L, -1);
  if (t === LUA_TNIL) {
    return null;
  }
  if (t === LUA_TBOOLEAN) {
    return lib.symbols.lua_toboolean(L, -1) !== 0;
  }
  if (t === LUA_TNUMBER) {
    return lib.symbols.lua_tonumberx(L, -1, 0);
  }
  if (t === LUA_TSTRING) {
    return fromCString(lib.symbols.lua_tolstring(L, -1, 0));
  }
  if (t === LUA_TTABLE) {
    const numeric: Map<number, JSJsonish> = new Map();
    const object: Record<string, JSJsonish> = {};
    let maxIndex = 0;
    let numericCount = 0;
    lib.symbols.lua_pushnil(L);
    while (lib.symbols.lua_next(L, -2) !== 0) {
      const keyType = lib.symbols.lua_type(L, -2);
      if (keyType === LUA_TNUMBER) {
        const k = lib.symbols.lua_tonumberx(L, -2, 0);
        const i = Math.trunc(k);
        if (i === k && i > 0) {
          const val = luaToJSFromTop(lib, L);
          numeric.set(i, val);
          if (i > maxIndex) {
            maxIndex = i;
          }
          numericCount++;
        }
      } else if (keyType === LUA_TSTRING) {
        const key = fromCString(lib.symbols.lua_tolstring(L, -2, 0));
        object[key] = luaToJSFromTop(lib, L);
      }
      lib.symbols.lua_settop(L, -2);
    }
    if (numericCount > 0 && Object.keys(object).length === 0) {
      const arr: JSJsonish[] = new Array(maxIndex);
      for (let i = 1; i <= maxIndex; i++) {
        arr[i - 1] = numeric.get(i) ?? null;
      }
      while (arr.length && arr.at(-1) === null) {
        arr.pop();
      }
      return arr;
    }
    for (const [k, v] of numeric) {
      object[String(k)] = v;
    }
    return object;
  }
  return null;
};

export const pushJSValue = (
  lib: LuaBindings,
  L: number,
  value: JSJsonish
): void => {
  if (value === null || value === undefined) {
    lib.symbols.lua_pushnil(L);
    return;
  }
  switch (typeof value) {
    case 'number':
      lib.symbols.lua_pushnumber(L, value);
      return;
    case 'boolean':
      lib.symbols.lua_pushboolean(L, value ? 1 : 0);
      return;
    case 'string': {
      const buf = toCStringBuffer(value);
      lib.symbols.lua_pushstring(L, buf as unknown as string);
      return;
    }
    default:
      if (Array.isArray(value)) {
        lib.symbols.lua_createtable(L, value.length, 0);
        for (let i = 0; i < value.length; i++) {
          pushJSValue(lib, L, value[i] as JSJsonish);
          lib.symbols.lua_rawseti(L, -2, i + 1);
        }
        return;
      }
      lib.symbols.lua_createtable(L, 0, Object.keys(value as object).length);
      for (const [k, v] of Object.entries(value as object)) {
        pushJSValue(lib, L, v as JSJsonish);
        const kbuf = toCStringBuffer(k);
        lib.symbols.lua_setfield(L, -2, kbuf as unknown as string);
      }
      return;
  }
};

export const runLuaChunkReturnNumber = (
  code: string,
  luaLibPath?: string | null
): number => {
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
    const num = lib.symbols.lua_tonumberx(L, -1, 0);
    return num;
  } finally {
    lib.symbols.lua_close(L);
  }
};

// File loading functionality for Lua modules
export const loadLuaFile = (filePath: string): string => {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load Lua file '${filePath}': ${error}`);
  }
};

export const resolveLuaModulePath = (
  moduleName: string,
  basePath?: string
): string => {
  const extensions = ['.lua', '/init.lua'];
  const searchPaths = [
    basePath ? resolve(basePath) : process.cwd(),
    join(process.cwd(), 'lua'),
    join(process.cwd(), 'src', 'lua'),
    join(process.cwd(), 'modules')
  ];

  // Handle relative paths
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    const resolved = resolve(basePath || process.cwd(), moduleName);
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
    // Try as directory with init.lua
    const initPath = join(resolved, 'init.lua');
    if (existsSync(initPath)) {
      return initPath;
    }
  }

  // Handle absolute paths
  if (moduleName.startsWith('/')) {
    for (const ext of extensions) {
      const fullPath = moduleName + ext;
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
    const initPath = join(moduleName, 'init.lua');
    if (existsSync(initPath)) {
      return initPath;
    }
  }

  // Search in standard paths
  for (const searchPath of searchPaths) {
    for (const ext of extensions) {
      const fullPath = join(searchPath, moduleName + ext);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
    // Try as directory with init.lua
    const initPath = join(searchPath, moduleName, 'init.lua');
    if (existsSync(initPath)) {
      return initPath;
    }
  }

  throw new Error(`Module '${moduleName}' not found`);
};
