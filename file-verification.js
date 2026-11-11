import crypto from 'node:crypto';

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
  const first = original.indexOf(args.target_content);
  if (first < 0 || original.indexOf(args.target_content, first + 1) >= 0) {
    throw Error('Patch target must match exactly once; include more surrounding lines');
  }
  return hash(original.slice(0, first) + args.replacement_content + original.slice(first + args.target_content.length));
}

export function verifyFileHash(output, expected) {
  const match = /^([a-f0-9]{64})\s*\n\[код: 0\]$/.exec(output);
  if (!match || match[1] !== expected) throw Error('File contents do not match the intended write, or the file could not be read');
}
