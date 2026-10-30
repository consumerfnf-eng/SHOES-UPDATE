import {createHash} from 'node:crypto';

/** The brands a weekly collection covers, in the order it reads them.
 *
 *  Luxury first: the maisons need the rendered reader and its paid credits,
 *  and a run that spends them on a store serving plain HTML has spent them on
 *  the one kind of shop that did not need them.
 */
export function collectedBrandList(policy) {
  return policy.brands.filter(b=>b.mandatory||b.policy==='core')
    .sort((a,b)=>Number(b.group==='luxury')-Number(a.group==='luxury')).map(b=>b.name);
}

/** What a run was asked to collect, as one value.
 *
 *  "This week is already done" used to mean only "a collection finished since
 *  Sunday". Widening the brand list from 60 to 76 on 2026-10-30 therefore
 *  changed nothing: the guard still called the week complete and the sixteen
 *  new maisons were never once fetched, through two manual re-runs. A week is
 *  only complete for the brands and shelves it actually covered, so the list
 *  and every configured source URL - with its basis, since changing a shelf
 *  from New-only to whole-catalogue changes what it yields - are part of the
 *  question.
 */
export function brandFingerprint(brands,sources) {
  const shelves=brands.map(brand=>[brand,...(sources[brand]||[]).map(s=>`${s.url}|${s.basis||''}`).sort()].join('>'));
  return createHash('sha256').update(JSON.stringify(shelves.sort())).digest('hex').slice(0,16);
}
