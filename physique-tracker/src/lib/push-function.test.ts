import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { OUT, buildPushFunction } from '../../scripts/build-push-function.mjs';

describe('send-reminders Edge Function', () => {
  it('is regenerated from the current reminder rules (run scripts/build-push-function.mjs)', () => {
    expect(readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n')).toBe(buildPushFunction());
  });
  it('is valid TypeScript syntax', async () => {
    await expect(transform(buildPushFunction(), { loader: 'ts' })).resolves.toBeTruthy();
  });
  it('carries a VAPID public key', () => {
    expect(buildPushFunction()).toMatch(/const VAPID_PUBLIC_KEY = '[A-Za-z0-9_-]{80,}';/);
  });
});
