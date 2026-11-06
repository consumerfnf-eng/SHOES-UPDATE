import fs from 'node:fs/promises';import {adminD1} from './admin-d1.mjs';
const db=adminD1(),rows=(await db.prepare('SELECT r.image_hash,r.category,r.status,r.reviewed_at,r.revision,c.data FROM visual_classification_reviews r LEFT JOIN visual_classification_candidates c ON c.image_hash=r.image_hash ORDER BY r.reviewed_at').all()).results;
const records=rows.map(row=>({imageHash:row.image_hash,category:row.category,status:row.status,reviewedAt:row.reviewed_at,revision:row.revision,reviewer:'authenticated-owner',products:row.data?JSON.parse(row.data).products:[]}));
await fs.mkdir('.secrets/clip',{recursive:true});await fs.writeFile('.secrets/clip/owner-labels.json',JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),records},null,2));
console.log(JSON.stringify({ownerDecisions:records.length,file:'.secrets/clip/owner-labels.json'}));
