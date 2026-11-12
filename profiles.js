export const PROFILES=Object.freeze(['coding','trading']);

// External MCP servers can still expose the old names or common trading aliases.
const tradingPrefix=/^(?:exchange_|paper_exchange_|trading_|trade_|broker_|stock_|crypto_|order_|portfolio_|finance_|investing_|forex_|futures_|ticker_|position_)/i;
const tradingNames=new Set(['place_order','create_order','cancel_order','market_order','buy','sell','buy_stock','sell_stock','get_portfolio','get_positions','get_order','get_orders','get_orderbook','get_balance','get_account_balance','get_market_data','get_quote','get_quotes','get_ticker','get_tickers']);
export function isTradingTool(name){return typeof name==='string'&&(tradingPrefix.test(name)||tradingNames.has(name.toLowerCase()))}
export function toolsForProfile(tools,profile){return profile==='trading'?tools:tools.filter(tool=>!isTradingTool(tool.name))}
