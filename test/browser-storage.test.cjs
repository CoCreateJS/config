const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/browser.js'), 'utf8')
    .replace("import { configAPI, registerAdapter } from './core.js';", '')
    .replace("import('@cocreate/local-storage')", 'loadStorage()')
    .replace('export default configAPI;', '');

test('token and clientId are available before the optional adapter loads', () => {
    const values = new Map([['token', 'existing-session'], ['clientId', 'existing-client']]);
    const localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
    let adapter;
    vm.runInNewContext(source, {
        window: { localStorage }, configAPI: {},
        registerAdapter: value => { adapter = value; },
        loadStorage: () => new Promise(() => {})
    });
    assert.equal(adapter.getLocalStorageItem('token'), 'existing-session');
    assert.equal(adapter.getLocalStorageItem('clientId'), 'existing-client');
    adapter.setLocalStorageItem('token', 'new-session');
    assert.equal(values.get('token'), 'new-session');
    adapter.removeLocalStorageItem('token');
    assert.equal(values.has('token'), false);
});

test('blocked browser storage does not prevent Config initialization', () => {
    const window = {};
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
    let adapter;
    vm.runInNewContext(source, {
        window, configAPI: {}, registerAdapter: value => { adapter = value; },
        loadStorage: () => new Promise(() => {})
    });
    assert.equal(adapter.getLocalStorageItem('token'), null);
});
