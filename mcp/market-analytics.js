const intervals={"1m":60000,"5m":300000,"15m":900000,"1h":3600000};
const round=n=>Number.isFinite(n)?Number(n.toFixed(8)):null;

function ema(values,period){if(values.length<period)return null;let value=values.slice(0,period).reduce((a,b)=>a+b,0)/period;const alpha=2/(period+1);for(const price of values.slice(period))value=price*alpha+value*(1-alpha);return round(value)}
function rsi(values,period=14){if(values.length<=period)return null;let gains=0,losses=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gains+=Math.max(d,0);losses+=Math.max(-d,0)}gains/=period;losses/=period;for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gains=(gains*(period-1)+Math.max(d,0))/period;losses=(losses*(period-1)+Math.max(-d,0))/period}return round(losses===0?(gains===0?50:100):100-100/(1+gains/losses))}

export function analyzeMarket(market,now){
 const points=(Array.isArray(market.history)?market.history:[]).filter(p=>Number.isFinite(p?.time)&&p.time>0&&p.time<=now&&Number.isFinite(p.price)&&p.price>0).sort((a,b)=>a.time-b.time);
 const bid=market.bids?.[0]?.[0],ask=market.asks?.[0]?.[0],spread=Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>=bid?{bid,ask,absolute:round(ask-bid),percent_of_mid:round((ask-bid)/((ask+bid)/2)*100)}:null;
 const aggregation={};for(const [name,ms] of Object.entries(intervals)){
  const candles=[];for(const p of points){const start=Math.floor(p.time/ms)*ms;let candle=candles.at(-1);if(!candle||candle.start!==start){candle={start,open:p.price,high:p.price,low:p.price,close:p.price,samples:1};candles.push(candle)}else{candle.high=Math.max(candle.high,p.price);candle.low=Math.min(candle.low,p.price);candle.close=p.price;candle.samples++}}
  const closes=candles.map(c=>c.close),returns=closes.slice(1).map((p,i)=>Math.log(p/closes[i])),mean=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;
  const cutoff=now-ms,reference=points.findLast(p=>p.time<=cutoff),latest=points.at(-1);
  aggregation[name]={candles:candles.slice(-20),change_percent:reference&&latest?round((latest.price/reference.price-1)*100):null,volatility_percent:returns.length>=2?round(Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/(returns.length-1))*100):null,ema_9:ema(closes,9),rsi_14:rsi(closes),candle_count:candles.length,complete_candles:candles.filter(c=>c.start+ms<=now).length};
 }
 return {spread,intervals:aggregation,history:{samples:points.length,first_time:points[0]?.time??null,last_time:points.at(-1)?.time??null,source:'last 180 simulator price ticks; candles are tick-derived, may be incomplete, include no volume, and may mix live and synthetic ticks'},notice:'Null metrics mean insufficient retained history. Indicators include the current open candle; volatility is the sample standard deviation of candle log returns, not annualized.'};
}
