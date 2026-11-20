// Minimal structural checks for OpenAI-compatible Chat Completions. Provider-
// owned reasoning, multimodal content and tool arguments are never rewritten.
export class ProviderResponseError extends Error {
 constructor(code,message){super(message);this.name='ProviderResponseError';this.code=code;}
}

export function validateChatCompletion(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.choices)||!value.choices.length)
  throw new ProviderResponseError('missing_choice','The provider did not return a Chat Completions choice.');
 const choice=value.choices[0],message=choice?.message;
 if(!message||typeof message!=='object'||Array.isArray(message))
  throw new ProviderResponseError('missing_message','The provider did not return an assistant message.');
 if(message.role!==undefined&&message.role!=='assistant')
  throw new ProviderResponseError('invalid_role','The provider returned a message with an invalid role.');
 if(message.content!==undefined&&message.content!==null&&typeof message.content!=='string'&&!Array.isArray(message.content))
  throw new ProviderResponseError('invalid_content','The provider returned unsupported message content.');
 if(Array.isArray(message.content)&&message.content.some(part=>part===null||typeof part!=='object'||Array.isArray(part)))
  throw new ProviderResponseError('invalid_content','The provider returned malformed content parts.');
 const calls=message.tool_calls;
 if(calls!==undefined&&calls!==null&&!Array.isArray(calls))
  throw new ProviderResponseError('invalid_tool_calls','The provider returned malformed tool calls.');
 const ids=new Set();for(const call of calls||[]){
  if(!call||typeof call!=='object'||typeof call.id!=='string'||!call.id.trim()||!call.function||typeof call.function!=='object'||typeof call.function.name!=='string'||!call.function.name.trim()||(call.type!==undefined&&call.type!=='function'))
   throw new ProviderResponseError('invalid_tool_call','The provider returned an invalid tool call.');
  if(ids.has(call.id))throw new ProviderResponseError('duplicate_tool_call_id','The provider repeated a tool call ID in one response.');
  ids.add(call.id);
 }
 const content=typeof message.content==='string'?!!message.content.trim():Array.isArray(message.content)&&message.content.length>0;
 const refusal=typeof message.refusal==='string'&&!!message.refusal.trim();
 if(!content&&!refusal&&!ids.size)throw new ProviderResponseError('empty_message','The provider returned an empty assistant message.');
 return value;
}

// These are observations for the caller, not automatic retries or fallbacks.
export function chatCompletionWarnings(value){
 validateChatCompletion(value);
 const choice=value.choices[0],message=choice.message,warnings=[];
 if(choice.finish_reason==='length')warnings.push('output_truncated');
 const hasContent=typeof message.content==='string'?!!message.content.trim():Array.isArray(message.content)&&message.content.length>0;
 if(typeof message.refusal==='string'&&message.refusal.trim()&&!hasContent)warnings.push('refusal_without_content');
 if(Array.isArray(message.content))warnings.push('multimodal_content');
 return warnings;
}

export function providerContentText(message){const content=message?.content;return typeof content==='string'?content:Array.isArray(content)?content.filter(part=>part&&typeof part.text==='string').map(part=>part.text).join('\n'):'';}

export function requireCompleteSummary(message){const text=providerContentText(message).trim();if(message?._diabolixFinishReason==='length'||!text)throw new ProviderResponseError('incomplete_summary','The context summary is incomplete; the previous history was preserved.');return text;}
