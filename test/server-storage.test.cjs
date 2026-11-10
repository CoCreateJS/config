const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('server adapter preserves flat storage in global config and inherited environment', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocreate-config-storage-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const environment = {};
    let adapter;
    const source = fs.readFileSync(require.resolve('../src/server.js'), 'utf8')
        .replace(/^import .*;$/gm, '')
        .replace('export default configAPI;', '');
    vm.runInNewContext(source, {
        fs, path, os: { homedir: () => directory }, readline: {},
        process: { env: environment, cwd: () => directory },
        console, promisify: () => async () => ({}), childExec() {},
        configAPI: {}, registerAdapter: value => { adapter = value; }
    });
    const storage = {
        name: 'platform', provider: 'mongodb', connectionString: 'mongodb://example/platform'
    };
    await adapter.setGlobalConfig({ storage });
    const loaded = await adapter.getGlobalConfig();
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.storage)), storage);
    adapter.setEnv('storage', loaded.storage);
    assert.deepEqual(JSON.parse(environment.storage), storage);
    adapter.setEnv('organization_id', 'platform');
    assert.equal(environment.organization_id, 'platform');
});

test('server environment adapter resolves structured manager JSON while preserving primitive strings', () => {
    let adapter;
    const environment = { manager: JSON.stringify({ organization_id: 'platform', host: 'platform.test', apiKey: 'test-key' }),
        primitive: 'true', number: '42', malformed: '{invalid' };
    const source = fs.readFileSync(require.resolve('../src/server.js'), 'utf8')
        .replace(/^import .*;$/gm, '').replace('export default configAPI;', '');
    vm.runInNewContext(source, { fs, path, os, readline: {}, process: { env: environment }, console,
        promisify: () => async () => ({}), childExec() {}, configAPI: {}, registerAdapter: value => { adapter = value; } });
    assert.deepEqual(JSON.parse(JSON.stringify(adapter.getEnv('manager'))), JSON.parse(environment.manager));
    assert.equal(adapter.getEnv('primitive'), 'true');
    assert.equal(adapter.getEnv('number'), '42');
    assert.equal(adapter.getEnv('malformed'), '{invalid');
    assert.equal(adapter.getEnv('missing'), null);
});
