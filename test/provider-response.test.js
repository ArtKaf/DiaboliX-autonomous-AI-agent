import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateChatCompletion,chatCompletionWarnings,ProviderResponseError} from '../provider-response.js';
import {withProviderRetries} from '../provider-retry.js';
const completion=(message,finish_reason='stop')=>({choices:[{message,finish_reason}],usage:{prompt_tokens:4}});

test('accepts normal text, multimodal content and provider-owned reasoning without altering them',()=>{
 const text=completion({role:'assistant',content:'Done.',reasoning_content:'opaque',reasoning_details:[{type:'reasoning.encrypted',data:'x'}]});
 assert.equal(validateChatCompletion(text),text);assert.deepEqual(chatCompletionWarnings(text),[]);assert.equal(text.choices[0].message.reasoning_content,'opaque');
 const parts=[{type:'text',text:'A'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}],multimodal=completion({content:parts});
 assert.equal(validateChatCompletion(multimodal).choices[0].message.content,parts);assert.deepEqual(chatCompletionWarnings(multimodal),['multimodal_content']);
});

test('allows null content and preserves malformed JSON tool arguments for model self-correction',()=>{
 const calls=[{id:'one',type:'function',function:{name:'patch_file',arguments:'{invalid'}},{id:'two',function:{name:'read_file',arguments:{path:'x'}}}],response=completion({role:'assistant',content:null,tool_calls:calls,reasoning_content:'keep'} ,'tool_calls');
 assert.equal(validateChatCompletion(response),response);assert.equal(response.choices[0].message.tool_calls[0].function.arguments,'{invalid');assert.deepEqual(response.choices[0].message.tool_calls[1].function.arguments,{path:'x'});
});

test('rejects empty or structurally unusable replies without exposing provider text',()=>{
 const invalid=[null,{}, {choices:[]}, completion({}),completion({role:'assistant',content:null,tool_calls:[]}),completion({content:3}),completion({content:[null]}),completion({role:'user',content:'unexpected'}),completion({content:null,tool_calls:{}}),completion({content:null,tool_calls:[{id:'x',function:{name:'a'}},{id:'x',function:{name:'b'}}]}),completion({content:null,tool_calls:[{id:'',function:{name:'a'}}]}),completion({content:null,tool_calls:[{id:' ',function:{name:'a'}}]}),completion({content:null,tool_calls:[{id:'x',function:{name:' '}}]})];
 for(const value of invalid)assert.throws(()=>validateChatCompletion(value),ProviderResponseError);
 try{validateChatCompletion(completion({content:3,secret:'do not include'}))}catch(error){assert.equal(error.code,'invalid_content');assert.doesNotMatch(error.message,/do not include/)}
});

test('reports truncation and refusals without discarding them or changing retry policy',()=>{
 const refusal=completion({role:'assistant',content:null,refusal:'I cannot do that.'});assert.equal(validateChatCompletion(refusal),refusal);assert.deepEqual(chatCompletionWarnings(refusal),['refusal_without_content']);
 for(const content of ['', '  ', []])assert.ok(chatCompletionWarnings(completion({content,refusal:'Declined'})).includes('refusal_without_content'));
 const clipped=completion({content:'partial'},'length');assert.deepEqual(chatCompletionWarnings(clipped),['output_truncated']);
});

test('an invalid provider response retains the existing ten 30-second retries',async()=>{
 let attempts=0;const waits=[];
 await assert.rejects(withProviderRetries(async()=>{attempts++;return validateChatCompletion(completion({}))},{wait:async(ms)=>waits.push(ms)}),error=>error.code==='empty_message');
 assert.equal(attempts,11);assert.deepEqual(waits,Array(10).fill(30000));
});
test('compaction rejects missing or truncated summaries without accepting partial content',async()=>{const {requireCompleteSummary}=await import('../provider-response.js');assert.equal(requireCompleteSummary({content:' complete '}),'complete');assert.equal(requireCompleteSummary({content:[{type:'text',text:'a'},{type:'text',text:'b'}]}),'a\nb');assert.throws(()=>requireCompleteSummary({content:'partial',_diabolixFinishReason:'length'}),/previous history was preserved/);assert.throws(()=>requireCompleteSummary({content:[{type:'image',image:'x'}]}),/previous history was preserved/)});
