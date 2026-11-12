export const EFFORT_LEVELS = Object.freeze(['none','minimal','low','medium','high','xhigh','max']);
export const REASONING_KEYS = Object.freeze(['reasoningEffort','plannerReasoningEffort','workerReasoningEffort','reviewerReasoningEffort']);

export function validEffort(value, roleOverride = false) {
  return value === '' || (roleOverride && value === 'default') || EFFORT_LEVELS.includes(value);
}

export function resolveEffort(config, role) {
  const override = config[`${role}ReasoningEffort`];
  if (override === 'default') return '';
  return override || config.reasoningEffort || '';
}

// Preserve provider-owned reasoning fields verbatim; never render them in the UI.
export function assistantMessage(message) {
  const result = {role:'assistant',content:message.content ?? null};
  if (message.tool_calls?.length) result.tool_calls=message.tool_calls;
  for (const key of ['reasoning_content','reasoning_details']) {
    if (message[key] != null) result[key]=message[key];
  }
  return result;
}

export class ReasoningHistory {
  constructor(){this.owners=new WeakMap();}
  record(message,endpoint,model){const result=assistantMessage(message);this.owners.set(result,JSON.stringify([endpoint,model]));return result;}
  forModel(messages,endpoint,model){const owner=JSON.stringify([endpoint,model]);return messages.map(message=>{
    if(message.role!=='assistant'||!this.owners.has(message)||this.owners.get(message)===owner)return message;
    const {reasoning_content,reasoning_details,...rest}=message;return rest;
  });}
}
