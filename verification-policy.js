import {explicitlyForbidsTests,explicitlyForbidsBrowserCheck} from './browser-check.js';
// Preserve chronological, explicit reversals; vague requests do not silently
// revoke an earlier prohibition. These lexical checks are advisory safeguards,
// not a complete natural-language understanding or shell security boundary.
const negative=/(?:\b(?:not|never|without|no|disabled|forbid(?:den)?|cannot|can['’]t)\b|\bdo\s+not\b|\bdon['’]t\b|не\s+|нельзя|запрещ|отключ)/i;
const testWord=/(?:\btest(?:s|ing)?\b|тест)/i;
const browserWord=/(?:\bbrowser\b|браузер)/i;
const affirmative=/(?:\b(?:may|can|allow(?:ed)?|permitted|permission|go\s+ahead)\b|разрешаю|разрешено|можно|теперь\s+(?:запусти|запускай|проверь|протестируй|используй|открой))/i;
function explicitNegative(text,subject){const after='(?:\\b(?:disabled|forbidden|prohibited|must\\s+not|should\\s+not|not\\s+allowed)\\b|запрещ|отключ|нельзя|не\\s+запуска)';return new RegExp('(?:'+negative.source+').{0,80}(?:'+subject.source+')|(?:'+subject.source+').{0,60}'+after,'i').test(text)}
export function verificationRestrictions(messages){
 let tests=false,browser=false;
 for(const value of messages){
  const clauses=String(value||'').split(/[,;\n]|\bbut\b|\bhowever\b|(?:^|\s)но(?=\s|$)/i);
  for(const text of clauses){const forbidsTests=explicitlyForbidsTests(text)||explicitNegative(text,testWord);
   if(forbidsTests)tests=true;else if(affirmative.test(text)&&testWord.test(text))tests=false;
   const forbidsBrowser=explicitlyForbidsBrowserCheck(text)&&!explicitlyForbidsTests(text)||explicitNegative(text,browserWord);
   if(forbidsBrowser)browser=true;else if(affirmative.test(text)&&browserWord.test(text)&&!explicitNegative(text,browserWord))browser=false;
  }
 }
 return {testsForbidden:tests,browserForbidden:tests||browser};
}
