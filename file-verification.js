import crypto from 'node:crypto';
import patch from './sandbox/patch-match.cjs';

const hash = content => crypto.createHash('sha256').update(content).digest('hex');

// Compute the intended result from the pre-edit snapshot, independently of the
// sandbox's reported success. This also makes a conflicting edit detectable.
export function expectedFileHash(name, args, snapshot) {
  if (name === 'write_file') {
    if (typeof args.content !== 'string') throw Error('File content must be a string');
    return hash(args.content);
  }
  if (name !== 'patch_file' || !snapshot.exists || typeof args.target_content !== 'string' || !args.target_content || typeof args.replacement_content !== 'string') {
    throw Error('Cannot calculate the expected file contents');
  }
  const original = Buffer.from(snapshot.content, 'base64').toString('utf8');
  return hash(patch.patchText(original,args.target_content,args.replacement_content));
}

export function verifyFileHash(output, expected) {
  const match = /^([a-f0-9]{64})\s*\n\[код: 0\]$/.exec(output);
  if (!match || match[1] !== expected) throw Error('File contents do not match the intended write, or the file could not be read');
}
