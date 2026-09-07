const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSwContext({ fetchImpl, cachesImpl }) {
  const listeners = {};
  const context = vm.createContext({
    APP_META: { cacheName: 'cache-test-v1' },
    importScripts: () => {},
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() }
    },
    caches: cachesImpl,
    fetch: fetchImpl,
    URL
  });

  const swCode = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');
  vm.runInContext(swCode, context, { filename: 'sw.js' });
  return listeners;
}

test('SW: Navigation nutzt index.html Fallback bei Offline', async () => {
  const cacheCalls = [];
  const listeners = loadSwContext({
    fetchImpl: () => Promise.reject(new Error('offline')),
    cachesImpl: {
      open: async () => ({ put: () => Promise.resolve() }),
      match: async (request, options) => {
        cacheCalls.push({ request, options });
        if (request === './index.html') return { ok: true, source: 'index-cache' };
        return null;
      }
    }
  });

  let response;
  await listeners.fetch({
    request: {
      method: 'GET',
      url: 'https://example.test/month?tab=1',
      mode: 'navigate',
      destination: 'document'
    },
    respondWith: (promise) => {
      response = promise;
    }
  });

  const resolved = await response;
  assert.equal(resolved.source, 'index-cache');
  assert.equal(
    JSON.stringify(cacheCalls[0]),
    JSON.stringify({ request: './index.html', options: { ignoreSearch: true } })
  );
});

test('SW: Script-Fallback nutzt ignoreSearch, API-Fallback nicht', async () => {
  const cacheCalls = [];
  const listeners = loadSwContext({
    fetchImpl: () => Promise.reject(new Error('offline')),
    cachesImpl: {
      open: async () => ({ put: () => Promise.resolve() }),
      match: async (request, options) => {
        cacheCalls.push({ request, options });
        return { ok: true };
      }
    }
  });

  let scriptResponse;
  await listeners.fetch({
    request: {
      method: 'GET',
      url: 'https://example.test/app.js?v=2026-03-29-1',
      mode: 'same-origin',
      destination: 'script'
    },
    respondWith: (promise) => {
      scriptResponse = promise;
    }
  });
  await scriptResponse;

  let apiResponse;
  await listeners.fetch({
    request: {
      method: 'GET',
      url: 'https://example.test/api/data?x=1',
      mode: 'same-origin',
      destination: ''
    },
    respondWith: (promise) => {
      apiResponse = promise;
    }
  });
  await apiResponse;

  assert.equal(JSON.stringify(cacheCalls[0].options), JSON.stringify({ ignoreSearch: true }));
  assert.equal(cacheCalls[1].options, undefined);
});
