import {test} from 'node:test';import assert from 'node:assert/strict';import {verificationRestrictions} from '../verification-policy.js';
test('new explicit user clarifications can impose and revoke test or browser restrictions',()=>{
 assert.deepEqual(verificationRestrictions(['Do not run tests','You may now run the existing tests']),{testsForbidden:false,browserForbidden:false});
 assert.deepEqual(verificationRestrictions(['Не запускай тесты','Теперь разрешаю запускать тесты']),{testsForbidden:false,browserForbidden:false});
 assert.deepEqual(verificationRestrictions(['Do not use the browser','You may now use the browser']),{testsForbidden:false,browserForbidden:false});
 assert.deepEqual(verificationRestrictions(['Не запускай тесты','Исправь код']),{testsForbidden:true,browserForbidden:true});
 assert.deepEqual(verificationRestrictions(['Do not use the browser','You may now run the tests']),{testsForbidden:false,browserForbidden:true});
 assert.deepEqual(verificationRestrictions(['You may now run tests','Do not run tests']),{testsForbidden:true,browserForbidden:true});
 for(const update of ['Now do not run any tests','Теперь не запускай никакие тесты','Now the tests must remain disabled','No more testing'])assert.deepEqual(verificationRestrictions(['Do not run tests',update]),{testsForbidden:true,browserForbidden:true},update);
 assert.deepEqual(verificationRestrictions(['Do not run tests','You may run tests without network access']),{testsForbidden:false,browserForbidden:false});
 assert.deepEqual(verificationRestrictions(['Do not use the browser','You may use the browser without internet']),{testsForbidden:false,browserForbidden:false});
 assert.deepEqual(verificationRestrictions(['Do not use the browser','You may not use the browser']),{testsForbidden:false,browserForbidden:true});
 for(const update of ['Разрешаю запускать тесты, не меняй исходный код','You may run tests, but do not modify the source files'])assert.deepEqual(verificationRestrictions(['Do not run tests',update]),{testsForbidden:false,browserForbidden:false},update);
});
