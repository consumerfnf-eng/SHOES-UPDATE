// Collection queues stay in data/curation-review.json, outside delivery.
export function publicPublicationStatus(snapshot){
 const status=snapshot.sourceStatus||{};
 snapshot.sourceStatus=Object.fromEntries(['checkedAt','lastSuccessfulCollectionAt','lastVerifiedAdditionAt','selectionBasis','catalogExhaustive'].filter(k=>status[k]!==undefined).map(k=>[k,status[k]]));
 snapshot.sourceStatus.counts={published:snapshot.products.length};
 const published=new Set(snapshot.products.map(p=>p.brand));
 snapshot.brands=(snapshot.brands||[]).filter(b=>published.has(b.name));
 return snapshot;
}
export function compactPresentationDefaults(snapshot){
 for(const p of snapshot.products||[]){const view=p.presentation;if(!view)continue;
  if(view.image===p.image)delete view.image;
  if(view.sourceUrl===p.url)delete view.sourceUrl;
  if(view.checkedAt===p.lastVerifiedAt)delete view.checkedAt;
 }
 return snapshot;
}
