import { JSCallback } from 'bun:ffi';

import {
  fromCString,
  loadLuaBindings,
  loadLuaFile,
  luaToJSFromTop,
  pushJSValue,
  registerJSFunction,
  resolveLuaModulePath,
  toCStringBuffer
} from './helpers';
import type { JSFunc, JSJsonish, LuaBindings } from './types';

export class LuaVM {
  private lib: LuaBindings;
  private L: number;
  private callbacks: JSCallback[] = [];
  private moduleCache = new Map<string, JSJsonish>();
  private coroutineStates = new Map<string, string>();

  constructor(luaLibPath?: string | null) {
    this.lib = loadLuaBindings(luaLibPath);
    const L = this.lib.symbols.luaL_newstate();
    if (!L) throw new Error('luaL_newstate failed');
    this.L = L;
    this.lib.symbols.luaL_openlibs(this.L);
    this.setupModuleSystem();
  }
  registerFunction(name: string, fn: JSFunc) {
    const cb = registerJSFunction(this.lib, this.L, name, fn);
    this.callbacks.push(cb);
  }
  setGlobal(name: string, value: JSJsonish) {
    pushJSValue(this.lib, this.L, value);
    const nbuf = toCStringBuffer(name);
    this.lib.symbols.lua_setglobal(this.L, nbuf as unknown as string);
  }
  eval<T extends JSJsonish = JSJsonish>(code: string): T {
    const buf = toCStringBuffer(code);
    const loadStatus = this.lib.symbols.luaL_loadstring(
      this.L,
      buf as unknown as string
    );
    if (loadStatus !== 0) {
      const msg = fromCString(this.lib.symbols.lua_tolstring(this.L, -1, 0));
      throw new Error(`luaL_loadstring failed: ${msg}`);
    }
    const rc = this.lib.symbols.lua_pcallk(this.L, 0, 1, 0, 0, 0);
    if (rc !== 0) {
      const err = fromCString(this.lib.symbols.lua_tolstring(this.L, -1, 0));
      throw new Error(`lua_pcall failed: ${err}`);
    }
    const result = luaToJSFromTop(this.lib, this.L) as T;
    this.lib.symbols.lua_settop(this.L, 0);
    return result;
  }
  close() {
    for (const cb of this.callbacks) {
      try {
        cb.close();
      } catch {}
    }
    // Clean up coroutine states (no-op for now since we're not using actual Lua threads)
    this.lib.symbols.lua_close(this.L);
  }

  private setupModuleSystem() {
    // Register the require function
    const requireCallback = new JSCallback(
      (Lptr: number): number => {
        const argc = this.lib.symbols.lua_gettop(Lptr);
        if (argc < 1) {
          const err = toCStringBuffer('require() expects a module name');
          this.lib.symbols.lua_pushstring(Lptr, err as unknown as string);
          this.lib.symbols.lua_error(Lptr);
          return 0;
        }

        const moduleName = fromCString(
          this.lib.symbols.lua_tolstring(Lptr, 1, 0)
        );

        try {
          // Instead of converting to JS and back, let's handle require entirely in Lua
          const filePath = resolveLuaModulePath(moduleName);

          if (this.moduleCache.has(moduleName)) {
            // Module is cached, push it to the Lua stack
            // For now, we'll re-execute since we can't easily store Lua values
            const code = loadLuaFile(filePath);
            const buf = toCStringBuffer(code);
            const loadStatus = this.lib.symbols.luaL_loadstring(
              Lptr,
              buf as unknown as string
            );
            if (loadStatus !== 0) {
              const msg = fromCString(
                this.lib.symbols.lua_tolstring(Lptr, -1, 0)
              );
              throw new Error(`Failed to load module ${moduleName}: ${msg}`);
            }
            const rc = this.lib.symbols.lua_pcallk(Lptr, 0, 1, 0, 0, 0);
            if (rc !== 0) {
              const err = fromCString(
                this.lib.symbols.lua_tolstring(Lptr, -1, 0)
              );
              throw new Error(`Failed to execute module ${moduleName}: ${err}`);
            }
            return 1;
          } else {
            // Load and execute the module
            const code = loadLuaFile(filePath);
            const buf = toCStringBuffer(code);
            const loadStatus = this.lib.symbols.luaL_loadstring(
              Lptr,
              buf as unknown as string
            );
            if (loadStatus !== 0) {
              const msg = fromCString(
                this.lib.symbols.lua_tolstring(Lptr, -1, 0)
              );
              throw new Error(`Failed to load module ${moduleName}: ${msg}`);
            }
            const rc = this.lib.symbols.lua_pcallk(Lptr, 0, 1, 0, 0, 0);
            if (rc !== 0) {
              const err = fromCString(
                this.lib.symbols.lua_tolstring(Lptr, -1, 0)
              );
              throw new Error(`Failed to execute module ${moduleName}: ${err}`);
            }
            // Cache that we loaded this module
            this.moduleCache.set(moduleName, true);
            return 1;
          }
        } catch (error) {
          const err = toCStringBuffer(String(error));
          this.lib.symbols.lua_pushstring(Lptr, err as unknown as string);
          this.lib.symbols.lua_error(Lptr);
          return 0;
        }
      },
      { returns: 'i32', args: ['ptr'] }
    );

    this.lib.symbols.lua_pushcclosure(this.L, requireCallback.ptr as number, 0);
    const nameBuf = toCStringBuffer('require');
    this.lib.symbols.lua_setglobal(this.L, nameBuf as unknown as string);
    this.callbacks.push(requireCallback);
  }

  private requireModule(moduleName: string): JSJsonish {
    // Check cache first
    if (this.moduleCache.has(moduleName)) {
      return this.moduleCache.get(moduleName)!;
    }

    // Resolve module path
    const filePath = resolveLuaModulePath(moduleName);
    const code = loadLuaFile(filePath);

    // Execute the module and return the result
    // The module should return a table/value at the end
    const result = this.eval<JSJsonish>(code);

    // Cache the result
    this.moduleCache.set(moduleName, result);

    return result;
  }

  // Load and execute a Lua file
  loadFile<T extends JSJsonish = JSJsonish>(filePath: string): T {
    const code = loadLuaFile(filePath);
    return this.eval<T>(code);
  }

  // Simple coroutine support (just async execution for now)
  createCoroutine(code: string): string {
    const coId = `co_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // For now, just store the code - we'll execute it when resumed
    this.coroutineStates.set(coId, code as any);

    return coId;
  }

  resumeCoroutine(
    coId: string,
    ...args: JSJsonish[]
  ): { status: 'yielded' | 'dead'; result: JSJsonish } {
    const code = this.coroutineStates.get(coId) as string;
    if (!code) throw new Error(`Coroutine ${coId} not found`);

    try {
      // Set arguments as global variables for the coroutine
      if (args.length > 0) {
        for (let i = 0; i < args.length; i++) {
          this.setGlobal(`arg${i + 1}`, args[i]);
        }
      }

      const result: JSJsonish = (this.eval(code) as any) ?? null;
      this.coroutineStates.delete(coId);
      return { status: 'dead', result };
    } catch (error) {
      this.coroutineStates.delete(coId);
      throw error;
    }
  }

  // Async coroutine helper
  async runCoroutineAsync(
    code: string,
    ...args: JSJsonish[]
  ): Promise<JSJsonish> {
    const coId = this.createCoroutine(code);
    const results: JSJsonish[] = [];

    let status: { status: 'yielded' | 'dead'; result: JSJsonish };
    do {
      status = this.resumeCoroutine(coId, ...args);
      results.push(status.result);
      // In a real async scenario, you might yield control here
      if (status.status === 'yielded') {
        await new Promise(resolve => setImmediate(resolve));
      }
    } while (status.status === 'yielded');

    return results.length === 1 ? results[0]! : results;
  }
}
