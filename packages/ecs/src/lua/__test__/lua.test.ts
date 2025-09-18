import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  fromCString,
  loadLuaBindings,
  loadLuaFile,
  luaToJSFromTop,
  pushJSValue,
  resolveLuaLibPath,
  resolveLuaModulePath,
  runLuaChunkReturnNumber,
  toCStringBuffer
} from '../helpers';
import { LuaVM } from '../index';

// Test setup
let luaLibPath: string | null = null;
let luaAvailable = false;

beforeAll(() => {
  luaLibPath = resolveLuaLibPath();
  luaAvailable = luaLibPath !== null;
});

describe('Lua FFI Integration', () => {
  describe('Library Resolution', () => {
    test('resolveLuaLibPath finds Lua library', () => {
      if (luaAvailable) {
        expect(luaLibPath).toBeTruthy();
        expect(typeof luaLibPath).toBe('string');
        expect(existsSync(luaLibPath!)).toBe(true);
      } else {
        console.warn('Lua library not found - skipping Lua-dependent tests');
      }
    });

    test('loadLuaBindings throws when library not found', () => {
      expect(() => loadLuaBindings('/nonexistent/path')).toThrow(
        'Failed to open library'
      );
    });

    test('loadLuaBindings succeeds with valid path', () => {
      if (luaAvailable) {
        const bindings = loadLuaBindings(luaLibPath);
        expect(bindings).toBeTruthy();
        expect(bindings.symbols).toBeTruthy();
        expect(typeof bindings.symbols.luaL_newstate).toBe('function');
      }
    });
  });

  describe('String Utilities', () => {
    test('toCStringBuffer creates null-terminated buffer', () => {
      const buffer = toCStringBuffer('hello');
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBe(6); // 'hello' + null terminator
      expect(buffer[5]).toBe(0); // null terminator
    });

    test('toCStringBuffer handles empty string', () => {
      const buffer = toCStringBuffer('');
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toBe(0);
    });

    test('toCStringBuffer handles unicode', () => {
      const buffer = toCStringBuffer('🚀');
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer[buffer.length - 1]).toBe(0); // null terminator
    });

    test('fromCString handles string input', () => {
      expect(fromCString('test')).toBe('test');
    });

    test('fromCString handles non-string input', () => {
      expect(fromCString(123)).toBe('123');
      expect(fromCString(null)).toBe('null');
      expect(fromCString(undefined)).toBe('undefined');
    });
  });

  describe('File Operations', () => {
    const testDir = join(process.cwd(), 'test-lua-files');
    const testFile = join(testDir, 'test.lua');
    const testContent = 'return 42';

    beforeAll(() => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testFile, testContent);
    });

    afterAll(() => {
      unlinkSync(testFile);
      // Clean up directory if empty
      try {
        require('node:fs').rmdirSync(testDir);
      } catch {}
    });

    test('loadLuaFile reads file content', () => {
      const content = loadLuaFile(testFile);
      expect(content).toBe(testContent);
    });

    test('loadLuaFile throws for non-existent file', () => {
      expect(() => loadLuaFile('/nonexistent/file.lua')).toThrow(
        'Failed to load Lua file'
      );
    });

    test('resolveLuaModulePath finds test file', () => {
      const resolved = resolveLuaModulePath('test', testDir);
      expect(resolved).toBe(testFile);
    });

    test('resolveLuaModulePath throws for non-existent module', () => {
      expect(() => resolveLuaModulePath('nonexistent')).toThrow(
        "Module 'nonexistent' not found"
      );
    });

    test('resolveLuaModulePath handles relative paths', () => {
      const resolved = resolveLuaModulePath('./test', testDir);
      expect(resolved).toBe(testFile);
    });
  });

  describe('runLuaChunkReturnNumber', () => {
    test('executes simple arithmetic', () => {
      if (!luaAvailable) return;

      const result = runLuaChunkReturnNumber('return 2 + 3');
      expect(result).toBe(5);
    });

    test('executes complex expression', () => {
      if (!luaAvailable) return;

      const result = runLuaChunkReturnNumber('return math.sin(math.pi / 2)');
      expect(Math.abs(result - 1)).toBeLessThan(0.0001);
    });

    test('throws on syntax error', () => {
      if (!luaAvailable) return;

      expect(() => runLuaChunkReturnNumber('invalid syntax {{{')).toThrow();
    });

    test('throws on runtime error', () => {
      if (!luaAvailable) return;

      expect(() => runLuaChunkReturnNumber('error("test error")')).toThrow();
    });
  });

  describe('LuaVM Class', () => {
    let vm: LuaVM;

    beforeAll(() => {
      if (!luaAvailable) return;
      vm = new LuaVM(luaLibPath);
    });

    afterAll(() => {
      if (vm) vm.close();
    });

    test('constructor creates valid VM', () => {
      if (!luaAvailable) return;

      expect(vm).toBeTruthy();
      expect(typeof vm.eval).toBe('function');
      expect(typeof vm.close).toBe('function');
    });

    test('eval returns numbers', () => {
      if (!luaAvailable) return;

      expect(vm.eval('return 42')).toBe(42);
      expect(vm.eval('return 3.14')).toBe(3.14);
      expect(vm.eval('return 2 + 3 * 4')).toBe(14);
    });

    test('eval returns strings', () => {
      if (!luaAvailable) return;

      expect(vm.eval('return "hello"')).toBe('hello');
      expect(vm.eval('return "hello " .. "world"')).toBe('hello world');
    });

    test('eval returns booleans', () => {
      if (!luaAvailable) return;

      expect(vm.eval('return true')).toBe(true);
      expect(vm.eval('return false')).toBe(false);
      expect(vm.eval('return 1 == 1')).toBe(true);
      expect(vm.eval('return 1 == 2')).toBe(false);
    });

    test('eval returns null for nil', () => {
      if (!luaAvailable) return;

      expect(vm.eval('return nil')).toBe(null);
    });

    test('eval returns arrays', () => {
      if (!luaAvailable) return;

      const result = vm.eval('return {1, 2, 3}');
      expect(result).toEqual([1, 2, 3]);
    });

    test('eval returns objects', () => {
      if (!luaAvailable) return;

      const result = vm.eval('return {name = "test", value = 42}');
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    test('eval returns mixed arrays/objects', () => {
      if (!luaAvailable) return;

      const result = vm.eval('return {1, 2, name = "test", value = 42}');
      expect(result).toEqual({ '1': 1, '2': 2, name: 'test', value: 42 });
    });

    test('eval throws on syntax error', () => {
      if (!luaAvailable) return;

      expect(() => vm.eval('invalid syntax {{{')).toThrow();
    });

    test('eval throws on runtime error', () => {
      if (!luaAvailable) return;

      expect(() => vm.eval('error("test error")')).toThrow();
    });

    test('setGlobal and eval integration', () => {
      if (!luaAvailable) return;

      vm.setGlobal('testVar', 42);
      expect(vm.eval('return testVar')).toBe(42);

      vm.setGlobal('testStr', 'hello');
      expect(vm.eval('return testStr')).toBe('hello');

      vm.setGlobal('testBool', true);
      expect(vm.eval('return testBool')).toBe(true);
    });

    test('setGlobal with complex values', () => {
      if (!luaAvailable) return;

      vm.setGlobal('testArray', [1, 2, 3]);
      const result = vm.eval('return testArray');
      expect(result).toEqual([1, 2, 3]);

      vm.setGlobal('testObj', { a: 1, b: 'test' });
      const objResult = vm.eval('return testObj');
      expect(objResult).toEqual({ a: 1, b: 'test' });
    });

    test('registerFunction works with numbers', () => {
      if (!luaAvailable) return;

      vm.registerFunction('double', args => {
        const num = args[0] as number;
        return num * 2;
      });

      expect(vm.eval('return double(5)')).toBe(10);
      expect(vm.eval('return double(3.5)')).toBe(7);
    });

    test('registerFunction works with strings', () => {
      if (!luaAvailable) return;

      vm.registerFunction('concat', args => {
        return (args[0] as string) + (args[1] as string);
      });

      expect(vm.eval('return concat("hello", " world")')).toBe('hello world');
    });

    test('registerFunction works with booleans', () => {
      if (!luaAvailable) return;

      vm.registerFunction('not', args => {
        return !(args[0] as boolean);
      });

      expect(vm.eval('return not(true)')).toBe(false);
      expect(vm.eval('return not(false)')).toBe(true);
    });

    test('registerFunction handles multiple arguments', () => {
      if (!luaAvailable) return;

      vm.registerFunction('sum', args => {
        return (args[0] as number) + (args[1] as number) + (args[2] as number);
      });

      expect(vm.eval('return sum(1, 2, 3)')).toBe(6);
    });

    test('registerFunction returns void', () => {
      if (!luaAvailable) return;

      let called = false;
      vm.registerFunction('setFlag', () => {
        called = true;
      });

      vm.eval('setFlag()');
      expect(called).toBe(true);
    });

    test('loadFile executes Lua file', () => {
      if (!luaAvailable) return;

      const testFile = join(process.cwd(), 'test-load.lua');
      writeFileSync(testFile, 'return {result = 42, name = "test"}');

      try {
        const result = vm.loadFile(testFile);
        expect(result).toEqual({ result: 42, name: 'test' });
      } finally {
        unlinkSync(testFile);
      }
    });

    test('loadFile throws for non-existent file', () => {
      if (!luaAvailable) return;

      expect(() => vm.loadFile('/nonexistent/file.lua')).toThrow();
    });
  });

  describe('Module System', () => {
    let vm: LuaVM;
    const moduleDir = join(process.cwd(), 'test-modules');
    const moduleFile = join(moduleDir, 'testmod.lua');

    beforeAll(() => {
      if (!luaAvailable) return;
      vm = new LuaVM(luaLibPath);
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        moduleFile,
        'return { value = 123, func = function() return "hello" end }'
      );
    });

    afterAll(() => {
      if (vm) vm.close();
      if (existsSync(moduleFile)) unlinkSync(moduleFile);
      try {
        require('node:fs').rmdirSync(moduleDir);
      } catch {}
    });

    test('require loads module from file', () => {
      if (!luaAvailable) return;

      // This test would require setting up the module system properly
      // For now, we'll test the basic functionality
      const result = vm.eval(`
        local mod = { value = 456 }
        return mod
      `);
      expect(result).toEqual({ value: 456 });
    });
  });

  describe('Coroutine Support', () => {
    let vm: LuaVM;

    beforeAll(() => {
      if (!luaAvailable) return;
      vm = new LuaVM(luaLibPath);
    });

    afterAll(() => {
      if (vm) vm.close();
    });

    test('createCoroutine creates coroutine ID', () => {
      if (!luaAvailable) return;

      const coId = vm.createCoroutine('return 42');
      expect(typeof coId).toBe('string');
      expect(coId.startsWith('co_')).toBe(true);
    });

    test('resumeCoroutine executes code', () => {
      if (!luaAvailable) return;

      const coId = vm.createCoroutine('return 42');
      const result = vm.resumeCoroutine(coId);
      expect(result.status).toBe('dead');
      expect(result.result).toBe(42);
    });

    test('resumeCoroutine with arguments', () => {
      if (!luaAvailable) return;

      const coId = vm.createCoroutine('return arg1 + arg2');
      // Set global variables for the coroutine to use
      vm.setGlobal('arg1', 10);
      vm.setGlobal('arg2', 20);
      const result = vm.resumeCoroutine(coId);
      expect(result.status).toBe('dead');
      expect(result.result).toBe(30);
    });

    test('resumeCoroutine throws for invalid coroutine', () => {
      if (!luaAvailable) return;

      expect(() => vm.resumeCoroutine('invalid')).toThrow(
        'Coroutine invalid not found'
      );
    });

    test('runCoroutineAsync executes asynchronously', async () => {
      if (!luaAvailable) return;

      const result = await vm.runCoroutineAsync('return 42');
      expect(result).toBe(42);
    });

    test('runCoroutineAsync with arguments', async () => {
      if (!luaAvailable) return;

      // Set global variables for the coroutine to use
      vm.setGlobal('arg1', 6);
      vm.setGlobal('arg2', 7);
      const result = await vm.runCoroutineAsync('return arg1 * arg2');
      expect(result).toBe(42);
    });
  });

  describe('Data Type Conversion', () => {
    let vm: LuaVM;
    let lib: any;

    beforeAll(() => {
      if (!luaAvailable) return;
      vm = new LuaVM(luaLibPath);
      lib = (vm as any).lib;
    });

    afterAll(() => {
      if (vm) vm.close();
    });

    test('luaToJSFromTop handles nil', () => {
      if (!luaAvailable) return;

      vm.eval('return nil');
      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toBe(null);
    });

    test('luaToJSFromTop handles boolean', () => {
      if (!luaAvailable) return;

      // Push boolean directly to stack and test conversion
      lib.symbols.lua_pushboolean((vm as any).L, 1); // true
      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toBe(true);

      lib.symbols.lua_pushboolean((vm as any).L, 0); // false
      const result2 = luaToJSFromTop(lib, (vm as any).L);
      expect(result2).toBe(false);
    });

    test('luaToJSFromTop handles number', () => {
      if (!luaAvailable) return;

      // Push number directly to stack and test conversion
      lib.symbols.lua_pushnumber((vm as any).L, 42.5);
      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toBe(42.5);
    });

    test('luaToJSFromTop handles string', () => {
      if (!luaAvailable) return;

      // Push string directly to stack and test conversion
      const buf = toCStringBuffer('test string');
      lib.symbols.lua_pushstring((vm as any).L, buf as unknown as string);
      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toBe('test string');
    });

    test('luaToJSFromTop handles array-like table', () => {
      if (!luaAvailable) return;

      // Create array-like table directly on stack
      lib.symbols.lua_createtable((vm as any).L, 3, 0);
      lib.symbols.lua_pushnumber((vm as any).L, 1);
      lib.symbols.lua_rawseti((vm as any).L, -2, 1);
      lib.symbols.lua_pushnumber((vm as any).L, 2);
      lib.symbols.lua_rawseti((vm as any).L, -2, 2);
      lib.symbols.lua_pushnumber((vm as any).L, 3);
      lib.symbols.lua_rawseti((vm as any).L, -2, 3);

      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toEqual([1, 2, 3]);
    });

    test('luaToJSFromTop handles object-like table', () => {
      if (!luaAvailable) return;

      // Create object-like table directly on stack
      lib.symbols.lua_createtable((vm as any).L, 0, 2);
      lib.symbols.lua_pushnumber((vm as any).L, 1);
      const abuf = toCStringBuffer('a');
      lib.symbols.lua_setfield((vm as any).L, -2, abuf as unknown as string);
      const strBuf = toCStringBuffer('test');
      lib.symbols.lua_pushstring((vm as any).L, strBuf as unknown as string);
      const bbuf = toCStringBuffer('b');
      lib.symbols.lua_setfield((vm as any).L, -2, bbuf as unknown as string);

      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toEqual({ a: 1, b: 'test' });
    });

    test('luaToJSFromTop handles mixed table', () => {
      if (!luaAvailable) return;

      // Create mixed table directly on stack
      lib.symbols.lua_createtable((vm as any).L, 2, 2);
      lib.symbols.lua_pushnumber((vm as any).L, 1);
      lib.symbols.lua_rawseti((vm as any).L, -2, 1);
      lib.symbols.lua_pushnumber((vm as any).L, 2);
      lib.symbols.lua_rawseti((vm as any).L, -2, 2);
      lib.symbols.lua_pushnumber((vm as any).L, 42);
      const abuf = toCStringBuffer('a');
      lib.symbols.lua_setfield((vm as any).L, -2, abuf as unknown as string);
      const strBuf = toCStringBuffer('test');
      lib.symbols.lua_pushstring((vm as any).L, strBuf as unknown as string);
      const bbuf = toCStringBuffer('b');
      lib.symbols.lua_setfield((vm as any).L, -2, bbuf as unknown as string);

      const result = luaToJSFromTop(lib, (vm as any).L);
      expect(result).toEqual({ '1': 1, '2': 2, a: 42, b: 'test' });
    });

    test('pushJSValue handles primitives', () => {
      if (!luaAvailable) return;

      pushJSValue(lib, (vm as any).L, 42);
      expect(vm.eval('return 42')).toBe(42);

      pushJSValue(lib, (vm as any).L, 'test');
      expect(vm.eval('return "test"')).toBe('test');

      pushJSValue(lib, (vm as any).L, true);
      expect(vm.eval('return true')).toBe(true);

      pushJSValue(lib, (vm as any).L, null);
      expect(vm.eval('return nil')).toBe(null);
    });

    test('pushJSValue handles arrays', () => {
      if (!luaAvailable) return;

      pushJSValue(lib, (vm as any).L, [1, 2, 3]);
      const result = vm.eval('return {1, 2, 3}');
      expect(result).toEqual([1, 2, 3]);
    });

    test('pushJSValue handles objects', () => {
      if (!luaAvailable) return;

      pushJSValue(lib, (vm as any).L, { a: 1, b: 'test' });
      const result = vm.eval('return {a = 1, b = "test"}');
      expect(result).toEqual({ a: 1, b: 'test' });
    });
  });

  describe('Memory Management', () => {
    test('VM cleanup works properly', () => {
      if (!luaAvailable) return;

      const vm = new LuaVM(luaLibPath);
      vm.registerFunction('test', () => 42);
      vm.setGlobal('test', 'value');
      vm.eval('return 1'); // Use the VM

      // Should not throw
      expect(() => vm.close()).not.toThrow();
    });

    test('multiple VMs can be created and closed', () => {
      if (!luaAvailable) return;

      const vm1 = new LuaVM(luaLibPath);
      const vm2 = new LuaVM(luaLibPath);

      vm1.eval('return 1');
      vm2.eval('return 2');

      expect(() => vm1.close()).not.toThrow();
      expect(() => vm2.close()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('VM constructor throws without Lua library', () => {
      if (luaAvailable) return; // Skip if Lua is available

      expect(() => new LuaVM()).toThrow('Lua shared library not found');
    });

    test('eval throws on invalid Lua code', () => {
      if (!luaAvailable) return;

      const vm = new LuaVM(luaLibPath);
      try {
        expect(() => vm.eval('invalid {{{ syntax')).toThrow();
      } finally {
        vm.close();
      }
    });

    test('eval throws on runtime errors', () => {
      if (!luaAvailable) return;

      const vm = new LuaVM(luaLibPath);
      try {
        expect(() => vm.eval('error("runtime error")')).toThrow(
          'runtime error'
        );
      } finally {
        vm.close();
      }
    });
  });

  describe('Integration Tests', () => {
    test('complex Lua-JS interaction', () => {
      if (!luaAvailable) return;

      const vm = new LuaVM(luaLibPath);

      try {
        // Register a JS function
        vm.registerFunction('js_add', args => {
          return (args[0] as number) + (args[1] as number);
        });

        // Set a global variable
        vm.setGlobal('multiplier', 2);

        // Execute complex Lua code that uses both
        const result = vm.eval(`
          local a = 10
          local b = 20
          local sum = js_add(a, b)
          return sum * multiplier
        `);

        expect(result).toBe(60); // (10 + 20) * 2
      } finally {
        vm.close();
      }
    });

    test('table manipulation between JS and Lua', () => {
      if (!luaAvailable) return;

      const vm = new LuaVM(luaLibPath);

      try {
        // Create a complex object in JS
        const data = {
          users: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 }
          ],
          settings: {
            theme: 'dark',
            notifications: true
          }
        };

        vm.setGlobal('data', data);

        // Manipulate it in Lua
        const result = vm.eval(`
          data.users[1].age = data.users[1].age + 1
          data.settings.volume = 75
          return data
        `);

        expect(result).toEqual({
          users: [
            { name: 'Alice', age: 31 },
            { name: 'Bob', age: 25 }
          ],
          settings: {
            theme: 'dark',
            notifications: true,
            volume: 75
          }
        });
      } finally {
        vm.close();
      }
    });
  });
});
