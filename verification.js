function diagnosticStatus(output){const text=String(output||'');if(!/\[код: 0\]\s*$/.test(text))return /\[код:/.test(text)?'failed':'unknown';return /(?:пропущен|недоступна|skipped|not available)/i.test(text)?'skipped':'passed'}
// Report observed facts only. This is not an autonomous pass/fail verdict.
export function buildVerification({state,tests,diagnosis,postEdit,events,computer}){
 const tree=state.tree;
 return {tree,changed_files:state.files,changed_files_truncated:state.has_more,
  project_diagnostics:diagnosis?{status:diagnosis.status,fresh:!!diagnosis.tree&&diagnosis.tree===tree,checked:diagnosis.checked.length,problems:diagnosis.problems.length,truncated:diagnosis.truncated,changed_during_check:diagnosis.changed_during_check}:null,
  post_edit_diagnostics:postEdit.slice(-15).map(([path,item])=>({path,fresh:!!item.tree&&item.tree===tree,status:diagnosticStatus(item.output),output:String(item.output||'').slice(0,800),truncated:String(item.output||'').length>800})),post_edit_diagnostics_omitted:Math.max(0,postEdit.length-15),
  tests:tests?{...tests,fresh:!!tests.tree&&tests.tree===tree&&!tests.changed_during_test}:{status:'not_observed_via_run_tests'},
  tool_evidence:events.slice(-30),computer_observations:computer.slice(-6),
  limitations:['This is a record of observations, not proof that the user task is complete.','run_command and external tools may perform operations not classified here.','Changed files exclude binary and protected paths; output may be truncated.','No tests, browser actions or commands are run by verify_task.']};
}
