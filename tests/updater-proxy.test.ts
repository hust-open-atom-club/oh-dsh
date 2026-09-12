import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('updater session tracks the OS proxy instead of round-tripping resolveProxy', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  // resolveProxy() returns PAC-style strings ("PROXY 127.0.0.1:7890", "DIRECT")
  // that setProxy({ proxyRules }) cannot parse: the round-trip poisoned the
  // updater session and every request failed with ERR_NO_SUPPORTED_PROXIES
  // whenever a system proxy was configured (ERR_EMPTY_RESPONSE without one).
  // Verified against Electron 42.3.0: proxyRules "PROXY host:port" fails,
  // proxyRules "host:port" and mode 'system' both work.
  const sync = main.match(/async function syncUpdaterProxy\(\): Promise<void> \{[\s\S]*?\n\}/)
  assert.ok(sync !== null, 'syncUpdaterProxy is defined in the main process')
  assert.match(sync[0], /setProxy\(\{ mode: 'system' \}\)/)
  assert.doesNotMatch(sync[0], /setProxy\(\{ proxyRules/)
  assert.doesNotMatch(sync[0], /= await .*resolveProxy/)

  // A proxy configuration the network stack cannot honor is as bypassable as
  // an unreachable one: the direct retry must rescue it too.
  const manager = readFileSync(new URL('../src/update-manager.ts', import.meta.url), 'utf8')
  const codes = manager.match(/PROXY_FAILURE_CODES = new Set\(\[([^\]]*)\]\)/)
  assert.ok(codes !== null, 'PROXY_FAILURE_CODES is defined')
  assert.match(codes[1]!, /'ERR_NO_SUPPORTED_PROXIES'/)
})
