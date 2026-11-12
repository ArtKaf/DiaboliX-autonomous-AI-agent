'use strict';
const path=require('node:path');
const manifests=new Set(['package.json','tsconfig.json','pyproject.toml','requirements.txt','cargo.toml','go.mod','dockerfile','readme.md','diabolix.md']);
function rankFiles(files,task=''){
 const terms=[...new Set(String(task).toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])].slice(0,32);
 return files.map((file,index)=>{const lower=file.toLowerCase(),base=path.posix.basename(lower);let score=manifests.has(base)?20:0;if(!lower.includes('/'))score+=4;for(const term of terms){if(base.includes(term))score+=12;else if(lower.includes(term))score+=4}return {file,index,score}}).sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.file);
}
module.exports={rankFiles};
