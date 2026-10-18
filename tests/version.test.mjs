import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const version = read('js/app.js').match(/const VERSION = '([\d.]+)'/)[1];

// A deploy must never mix old and new files, so every reference carries the same ?v=.
// Fix with: python tools/bump_version.py <version>
test('all module imports and tags use the app version', () => {
  for (const f of readdirSync(join(root, 'js'))) {
    for (const [, spec] of read(`js/${f}`).matchAll(/from '(\.\/[^']+)'/g)) {
      assert.equal(spec.split('?v=')[1], version, `${f}: ${spec}`);
    }
  }
  const html = read('index.html');
  assert.ok(html.includes(`src="js/app.js?v=${version}"`), 'index.html script tag');
  assert.ok(html.includes(`href="styles.css?v=${version}"`), 'index.html stylesheet');
  assert.ok(read('sw.js').includes(`const VERSION = '${version}'`), 'sw.js version');
});

test('the offline cache lists every module', () => {
  const list = read('sw.js').match(/\.\.\.\[([^\]]+)\]/)[1];
  for (const f of readdirSync(join(root, 'js'))) {
    assert.ok(list.includes(`'${f.replace('.js', '')}'`), `sw.js SHELL is missing ${f}`);
  }
});
