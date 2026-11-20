import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ShadowGit} from '../shadow.js';
import {compactReviewSnapshot} from '../review-snapshot.js';
import {buildSharedMemory,validateReviewRequirements} from '../shared-memory.js';

test('review inventory, changes and diff refer to the same tree and distinguish deleted files',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-review-tree-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'deleted.js'),'old');await writeFile(path.join(dir,'existing.js'),'old');
 const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());await rm(path.join(dir,'deleted.js'));await writeFile(path.join(dir,'new.js'),'new');
 const snapshot=await shadow.reviewSnapshot();assert.equal(snapshot.tree,snapshot.inventory.tree);assert.equal(snapshot.tree,snapshot.changes.tree);
 assert.deepEqual(snapshot.inventory.files.map(x=>x.path),['existing.js','new.js']);assert.deepEqual(snapshot.changes.files,[{path:'deleted.js',status:'D'},{path:'new.js',status:'A'}]);assert.match(snapshot.diff.diff,/\+new/);
 const compact=compactReviewSnapshot(snapshot,1);assert.equal(compact.inventory.files.length,0);assert.equal(compact.inventory.has_more,true);assert.equal(compact.changes.has_more,true);assert.match(compact.notice,/missing entry is not proof/i);
});

test('snapshot evidence is current only for its tree; historical summaries are hidden from reviewer',()=>{
 const tree='a'.repeat(40),other='b'.repeat(40),run='run',event={id:1,type:'review_observation',name:'workspace_snapshot',outcome:{status:'success',tree},memory_source:{scope:'shadow_text_files',basis:'tree_inventory',tree_before:tree,tree_after:tree}};
 const groups=[{run_id:run,events:[event,{id:2,type:'research_summary',text:'The project is empty'},{id:3,type:'task_memory',memory:{review_feedback:'Files are absent'}}]}],claims=[{id:'R1',status:'supported',evidence_ids:[1]}];
 const validate=(currentTree,eventsByRun=groups)=>validateReviewRequirements({task:'Create files',eventsByRun,currentRunId:run,currentTree,claims})[0];
 assert.equal(validate(tree).status,'supported_by_reviewer');assert.equal(validate(other).status,'unconfirmed');assert.equal(validate(tree,[{run_id:run,events:[{...event,type:'tool_result'}]}]).status,'unconfirmed');assert.equal(validate(tree,[{run_id:run,events:[{...event,outcome:{status:'success',tree:other}}]}]).status,'unconfirmed');
 const reviewer=buildSharedMemory({task:'Create files',groups,currentRunId:run,currentTree:tree,role:'reviewer'});assert.equal(reviewer.research_summary,undefined);assert.equal(reviewer.legacy_notes,undefined);assert.equal(reviewer.observations[0].freshness,'current');
});
