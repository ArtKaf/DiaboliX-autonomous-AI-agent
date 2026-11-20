import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatTelemetry} from '../public/telemetry.js';

test('token and elapsed-time totals are localized across roles',()=>{
 const result=formatTelemetry({worker:{prompt:1000,cached:30,completion:250,elapsed_ms:1250},reviewer:{prompt:25,cached:10,completion:5,elapsed_ms:500},steps:7},'en');
 assert.equal(result.prompt,'1,025');assert.equal(result.cached,'40');assert.equal(result.completion,'255');assert.equal(result.latency,'1.8 s');assert.equal(result.steps,7);assert.equal(result.cost,'—');
 assert.equal(formatTelemetry({worker:{elapsed_ms:1500}},'ru').latency,'1,5 с');
});
test('provider-reported costs are summed only within the same currency',()=>{
 const result=formatTelemetry({worker:{provider_cost:0.005,provider_currency:'USD'},reviewer:{provider_cost:0.003,provider_currency:'USD'},planner:{provider_cost:0.02,provider_currency:'EUR'}},'en');assert.equal(result.cost,'0.02 EUR / 0.008 USD');
 const mixed=formatTelemetry({worker:{provider_cost:0.5,provider_currency:'USD'},reviewer:{provider_cost:0.25}},'en');assert.equal(mixed.cost,'0.5 USD / 0.25');
 assert.equal(formatTelemetry({worker:{provider_cost:0,provider_currency:'USD'}},'en').cost,'0 USD');
});
test('missing, malformed or negative provider data do not become invented prices',()=>{
 for(const value of [undefined,null,'0.01',NaN,Infinity,-1])assert.equal(formatTelemetry({worker:{provider_cost:value}},'en').cost,'—');
 const result=formatTelemetry({worker:{prompt:-1,cached:'5',completion:Infinity,elapsed_ms:-2},steps:-3},'en');assert.equal(result.prompt,'0');assert.equal(result.cached,'0');assert.equal(result.completion,'0');assert.equal(result.latency,'0 s');assert.equal(result.steps,0);assert.equal(formatTelemetry(null,'en').cost,'—');
});
