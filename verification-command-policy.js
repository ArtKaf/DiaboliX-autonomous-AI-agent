// Advisory safeguard for common direct test invocations when a user explicitly
// forbids tests. Shell interpreters are Turing-complete, so this is not a
// security boundary and the model must also follow the user's instruction.
export function isLikelyTestCommand(command){
 const text=String(command||'');
 const executable='(?:\\/?[\\w.@-]+\\/)*(?:';
 const tests=executable+'pytest|py\\.test|jest|vitest|mocha|ava|tap|rspec|phpunit|nose2|tox|nox|bats)';
 const python=executable+'python(?:[0-9.]+)?|pypy(?:[0-9.]*)?)';
 const runtime=executable+'node|nodejs)';
 const npm=executable+'npm|pnpm|yarn|bun)';
 const patterns=[
  new RegExp('(?:^|[\\s;&|])'+tests+'(?:\\s|$)','i'),
  new RegExp('(?:^|[\\s;&|])'+python+'\\s+(?:[^;&|\\n]*?\\s+)?-m\\s+(?:pytest|unittest|nose2)(?:\\s|$)','i'),
  new RegExp('(?:^|[\\s;&|])'+runtime+'\\s+(?:[^;&|\\n]*?\\s+)?--test(?:\\s|$)','i'),
  new RegExp('(?:^|[\\s;&|])'+npm+'\\s+(?:(?:run|run-script)\\s+)?(?:test|test:[\\w-]+)(?:\\s|$)','i'),
  /(?:^|[\s;&|])(?:go|cargo|dotnet)\s+test(?:\s|$)/i,
 ];
 return patterns.some(pattern=>pattern.test(text));
}
