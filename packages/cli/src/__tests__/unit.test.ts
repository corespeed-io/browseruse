/**
 * Unit tests — pure function logic, no I/O, no browser.
 *
 * These re-implement the core logic from the production modules so we can test
 * the algorithms without modifying production exports.  The REPL integration
 * tests (repl.test.ts) verify the *actual* server behavior end-to-end.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
import { findChromePath } from '../browser.ts';

// ---------------------------------------------------------------------------
// isExpression — mirrors repl.ts:37-43
// ---------------------------------------------------------------------------

function isExpression(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (/[;\n]/.test(trimmed)) return false;
  if (/^(let|const|var|if|for|while|do|switch|class|function|throw|try|return|import|export)\b/.test(trimmed)) return false;
  return true;
}

describe('isExpression', () => {
  test('single expressions return true', () => {
    expect(isExpression('1+1')).toBe(true);
    expect(isExpression('session.Page')).toBe(true);
    expect(isExpression('await foo()')).toBe(true);
    expect(isExpression('({a:1})')).toBe(true);
    expect(isExpression('"hello"')).toBe(true);
    expect(isExpression('foo(1, 2)')).toBe(true);
    expect(isExpression('x ? 1 : 2')).toBe(true);
  });

  test('statements return false', () => {
    expect(isExpression('let x = 1')).toBe(false);
    expect(isExpression('const a = 1;')).toBe(false);
    expect(isExpression('var y = 2')).toBe(false);
    expect(isExpression('if (true) {}')).toBe(false);
    expect(isExpression('for (;;) {}')).toBe(false);
    expect(isExpression('while (true) {}')).toBe(false);
    expect(isExpression('do {} while(0)')).toBe(false);
    expect(isExpression('switch(x){}')).toBe(false);
    expect(isExpression('class Foo {}')).toBe(false);
    expect(isExpression('function f(){}')).toBe(false);
    expect(isExpression('throw new Error()')).toBe(false);
    expect(isExpression('try {} catch{}')).toBe(false);
    expect(isExpression('return 1')).toBe(false);
    expect(isExpression('import x from "y"')).toBe(false);
    expect(isExpression('export default 1')).toBe(false);
  });

  test('code with semicolons returns false', () => {
    expect(isExpression('a; b')).toBe(false);
    expect(isExpression('x = 1;')).toBe(false);
  });

  test('code with newlines returns false', () => {
    expect(isExpression('a\nb')).toBe(false);
    expect(isExpression('x = 1\ny = 2')).toBe(false);
  });

  test('edge cases', () => {
    expect(isExpression('')).toBe(false);
    expect(isExpression('   ')).toBe(false);
    expect(isExpression('  \t  ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serialize — mirrors repl.ts:45-52
// ---------------------------------------------------------------------------

function serialize(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return String(v);
  }
}

describe('serialize', () => {
  test('primitives', () => {
    expect(serialize(42)).toBe(42);
    expect(serialize('hello')).toBe('hello');
    expect(serialize(true)).toBe(true);
    expect(serialize(false)).toBe(false);
    expect(serialize(null)).toBe(null);
  });

  test('bigint converts to string', () => {
    expect(serialize(BigInt(123))).toBe('123');
    expect(serialize(BigInt(0))).toBe('0');
    expect(serialize(9007199254740993n)).toBe('9007199254740993');
  });

  test('objects and arrays', () => {
    expect(serialize({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' });
    expect(serialize([1, 2, 3])).toEqual([1, 2, 3]);
    expect(serialize({ nested: { x: true } })).toEqual({ nested: { x: true } });
    expect(serialize([])).toEqual([]);
    expect(serialize({})).toEqual({});
  });

  test('undefined returns undefined', () => {
    expect(serialize(undefined)).toBeUndefined();
  });

  test('circular references fall back to String()', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = serialize(obj);
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// renderResult — mirrors repl.ts:63-70
// ---------------------------------------------------------------------------

function renderResult(v: unknown): string {
  const s = serialize(v);
  if (s === undefined || s === null) return '';
  if (typeof s === 'string') return s;
  if (Array.isArray(s) && s.length === 0) return '';
  if (typeof s === 'object' && s !== null && Object.keys(s as object).length === 0) return '';
  return JSON.stringify(s);
}

describe('renderResult', () => {
  test('suppressed values return empty string', () => {
    expect(renderResult(undefined)).toBe('');
    expect(renderResult(null)).toBe('');
    expect(renderResult([])).toBe('');
    expect(renderResult({})).toBe('');
  });

  test('strings return as-is', () => {
    expect(renderResult('hello')).toBe('hello');
    expect(renderResult('some text')).toBe('some text');
  });

  test('empty string is returned as-is (it is a string)', () => {
    // serialize('') -> '', typeof '' === 'string' -> return ''
    expect(renderResult('')).toBe('');
  });

  test('numbers are JSON-stringified', () => {
    expect(renderResult(42)).toBe('42');
    expect(renderResult(3.14)).toBe('3.14');
    expect(renderResult(0)).toBe('0');
  });

  test('booleans are JSON-stringified', () => {
    expect(renderResult(true)).toBe('true');
    expect(renderResult(false)).toBe('false');
  });

  test('non-empty objects and arrays are JSON-stringified', () => {
    expect(renderResult({ a: 1 })).toBe('{"a":1}');
    expect(renderResult([1, 2])).toBe('[1,2]');
    expect(renderResult({ x: 'y', z: [1] })).toBe('{"x":"y","z":[1]}');
  });
});

// ---------------------------------------------------------------------------
// isBrowserLevel — mirrors session.ts:250-252
// ---------------------------------------------------------------------------

function isBrowserLevel(method: string): boolean {
  return method.startsWith('Browser.') || method.startsWith('Target.');
}

describe('isBrowserLevel', () => {
  test('Browser.* methods are browser-level', () => {
    expect(isBrowserLevel('Browser.getVersion')).toBe(true);
    expect(isBrowserLevel('Browser.setDownloadBehavior')).toBe(true);
  });

  test('Target.* methods are browser-level', () => {
    expect(isBrowserLevel('Target.getTargets')).toBe(true);
    expect(isBrowserLevel('Target.attachToTarget')).toBe(true);
    expect(isBrowserLevel('Target.createTarget')).toBe(true);
  });

  test('other domains are NOT browser-level', () => {
    expect(isBrowserLevel('Page.navigate')).toBe(false);
    expect(isBrowserLevel('DOM.getDocument')).toBe(false);
    expect(isBrowserLevel('Runtime.evaluate')).toBe(false);
    expect(isBrowserLevel('Network.enable')).toBe(false);
    expect(isBrowserLevel('Console.enable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findChromePath — imported from browser.ts
// ---------------------------------------------------------------------------

describe('findChromePath', () => {
  test('returns a string path', () => {
    const path = findChromePath();
    expect(typeof path).toBe('string');
    expect(path.length).toBeGreaterThan(0);
  });

  test('returned path exists on disk', () => {
    const path = findChromePath();
    expect(existsSync(path)).toBe(true);
  });
});
