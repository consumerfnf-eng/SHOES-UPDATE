// Stop starting new work at the phase deadline. An in-flight, timeout-bounded
// request is allowed to settle; no abandoned Promise.race requests keep running.
export function createCollectionBudget({durationMs,now=Date.now,label='COLLECTION'}={}) {
  const deadline=now()+durationMs;
  const exhausted=()=>now()>=deadline;
  return {deadline,exhausted,wrap(read){return async (...args)=>{
    if(exhausted())throw Error(`${label}_TIME_BUDGET`);
    return read(...args);
  };}};
}
