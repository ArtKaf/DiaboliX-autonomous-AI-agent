const SCALE=100000000n;
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const FEE_UNITS=100000n; // Simulator charges 0.1% in the received asset.
export function units(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=90000000)throw Error(`Invalid ${label}.`);const fixed=value.toFixed(8);if(Number(fixed)!==value)throw Error(`${label} supports at most 8 decimal places.`);const [whole,fraction]=fixed.split('.');const result=BigInt(whole)*SCALE+BigInt(fraction);if(result>MAX)throw Error(`${label} is too large.`);return result}
export function number(value){if(value<0n||value>MAX)throw Error('Calculated amount is outside supported precision.');return Number(value)/Number(SCALE)}
const ceil=(a,b)=>(a+b-1n)/b;
function feeFor(amount){return ceil(amount*FEE_UNITS,SCALE)}
export function fillBook(levels,side,{quantity,amount_usdt}){
 if((quantity===undefined)===(amount_usdt===undefined))throw Error('Provide exactly one of quantity or amount_usdt.');
 const byQuantity=quantity!==undefined;let remaining=byQuantity?units(quantity,'quantity'):units(amount_usdt,'amount_usdt');if(remaining<=0n)throw Error('Order size must be positive.');
 const quoteLimit=byQuantity?null:remaining;let budgetRaw=byQuantity?null:remaining*SCALE;
 if(!Array.isArray(levels)||!levels.length)throw Error('The order book is empty.');let last=side==='buy'?0n:MAX,raw=0n,totalQty=0n;const fills=[];
 for(const level of levels){if(!Array.isArray(level)||level.length<2)throw Error('Invalid order book.');const price=units(level[0],'book price'),size=units(level[1],'book quantity');if(!price||!size||(side==='buy'?price<last:price>last))throw Error('Invalid or unsorted order book.');last=price;const wanted=byQuantity?remaining:budgetRaw/price;const take=wanted<size?wanted:size;if(take){raw+=take*price;totalQty+=take;fills.push({price:number(price),quantity:number(take)});if(byQuantity)remaining-=take;else budgetRaw-=take*price}if(byQuantity?remaining===0n:budgetRaw<price)break;}
 if(byQuantity&&remaining>0n)throw Error('Insufficient paper order-book liquidity.');if(!byQuantity&&budgetRaw>=last)throw Error('Insufficient paper order-book liquidity for the USDT amount.');if(!totalQty)throw Error('Amount is too small for 8-decimal quantity precision.');
 const total=side==='buy'?ceil(raw,SCALE):raw/SCALE,fee=side==='sell'?feeFor(total):0n;if(total<=0n||side==='sell'&&total<=fee)throw Error('Order value is too small after fees.');if(quoteLimit!==null&&side==='buy'&&total>quoteLimit)throw Error('Rounded order would exceed the requested USDT amount.');
 return {quantity:number(totalQty),total_usdt:number(total),fee_usdt:number(fee),fills};
}
export function profitable(quantity,target,cost){
 const q=units(quantity,'protected quantity'),price=units(target,'take profit');if(typeof cost!=='number'||!Number.isFinite(cost)||cost<=0)throw Error('Invalid entry cost.');
 const rounded=Number(cost.toFixed(8));let costUnits=units(rounded,'entry cost');if(rounded<cost)costUnits++;
 const gross=q*price/SCALE;return gross-feeFor(gross)>costUnits;
}
