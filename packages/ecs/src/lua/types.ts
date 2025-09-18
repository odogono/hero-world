import { dlopen } from 'bun:ffi';

export type JSPrimitives = number | string | boolean | null;
export type JSJsonish = JSPrimitives | JSJsonish[] | { [k: string]: JSJsonish };

export type JSFunc = (
  args: Array<number | string | boolean>
) => number | string | boolean | void;

export type LuaBindings = ReturnType<typeof dlopen> & {
  symbols: {
    luaL_newstate(): number;
    luaL_openlibs(L: number): void;
    lua_close(L: number): void;
    luaL_loadstring(L: number, s: string): number;
    lua_pcallk(
      L: number,
      nargs: number,
      nresults: number,
      errfunc: number,
      ctx: number,
      k: number
    ): number;
    lua_tonumberx(L: number, idx: number, isnum: number): number;
    lua_tolstring(L: number, idx: number, len: number): string;
    lua_gettop(L: number): number;
    lua_type(L: number, idx: number): number;
    lua_pushnil(L: number): void;
    lua_next(L: number, idx: number): number;
    lua_settop(L: number, idx: number): void;
    lua_toboolean(L: number, idx: number): number;
    lua_pushcclosure(L: number, fn: number, n: number): void;
    lua_setglobal(L: number, name: string): void;
    lua_pushnumber(L: number, n: number): void;
    lua_pushstring(L: number, s: string): void;
    lua_pushboolean(L: number, b: number): void;
    lua_createtable(L: number, narr: number, nrec: number): void;
    lua_setfield(L: number, idx: number, k: string): void;
    lua_rawseti(L: number, idx: number, n: number): void;
    lua_error(L: number): number;
  };
};
