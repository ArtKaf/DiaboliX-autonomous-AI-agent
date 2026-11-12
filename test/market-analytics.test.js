import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMarket} from '../mcp/market-analytics.js';

test('tick history produces candle trends, spread and bounded indicators',()=>{
 const minute=60000,now=181*minute,history=Array.from({length:180},(_,i)=>({time:(i+1)*minute,price:100+i}));
 const result=analyzeMarket({history,bids:[[278,1]],asks:[[280,1]]},now);
 assert.equal(result.spread.absolute,2);assert.equal(result.history.samples,180);assert.equal(result.intervals['1m'].candles.length,20);assert.equal(result.intervals['1m'].rsi_14,100);assert.ok(result.intervals['1m'].ema_9>270);assert.ok(result.intervals['1h'].change_percent>0);assert.equal(result.intervals['1h'].rsi_14,null);assert.equal(result.intervals['1h'].candles.at(-1).close,279);assert.ok(result.intervals['5m'].volatility_percent>=0);
});

test('insufficient or invalid history never invents a period change or indicators',()=>{
 const now=600000;const result=analyzeMarket({history:[{time:now-1000,price:12},{time:now+1,price:13},{time:0,price:0}],bids:[[12,1]],asks:[[11,1]]},now);
 assert.equal(result.history.samples,1);assert.equal(result.spread,null);for(const interval of Object.values(result.intervals)){assert.equal(interval.change_percent,null);assert.equal(interval.ema_9,null);assert.equal(interval.rsi_14,null);assert.equal(interval.volatility_percent,null)}
});
