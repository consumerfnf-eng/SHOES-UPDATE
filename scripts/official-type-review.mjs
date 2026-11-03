// Exact source bindings keep visual classification from leaking to another shoe.
export function reviewedOfficialType(product,reviews=[]){
 const review=reviews.find(r=>r.verified&&r.brand===product.brand&&r.style===product.style&&r.url===product.url&&r.image===product.image);
 if(!review)return product;
 if(!review.approved)return {...product,typeReview:review};
 const category=review.category;
 return {...product,category,typeReview:review,footwearReview:{...review,approved:true,type:category},
  typeEvidence:{field:'reviewed-primary-construction',excerpt:review.reason,url:review.sourceUrl,contentHash:review.sourceHash,method:review.method},
  ...(category==='hybrid'?{hybridReview:{approved:true,url:product.url,brand:product.brand,style:product.style,type:'hybrid',sneakerSole:true,checkedAt:review.checkedAt,method:review.method}}:{})};
}
