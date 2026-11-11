import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { expectedFileHash, verifyFileHash } from '../file-verification.js';

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const snapshot = text => ({ exists: true, content: Buffer.from(text).toString('base64') });

test('write and patch verification use the intended file contents', () => {
  const write = expectedFileHash('write_file', { content: 'hello' }, { exists: false });
  assert.equal(write, hash('hello'));
  const patched = expectedFileHash('patch_file', { target_content: 'old', replacement_content: 'new' }, snapshot('before old after'));
  assert.equal(patched, hash('before new after'));
  assert.doesNotThrow(() => verifyFileHash(`${patched}\n[код: 0]`, patched));
  assert.throws(() => verifyFileHash(`${hash('wrong')}\n[код: 0]`, patched), /do not match/);
  assert.throws(() => verifyFileHash('read failed\n[код: 1]', patched), /could not be read/);
});

test('patch verification rejects missing and ambiguous target blocks', () => {
  const args = { target_content: 'old', replacement_content: 'new' };
  assert.throws(() => expectedFileHash('patch_file', args, snapshot('missing')), /exactly once/);
  assert.throws(() => expectedFileHash('patch_file', args, snapshot('old old')), /exactly once/);
});
