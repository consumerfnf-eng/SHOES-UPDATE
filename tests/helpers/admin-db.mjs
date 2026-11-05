import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function adminDb(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../../server/admin-schema.sql',import.meta.url),'utf8'));
 return {sqlite,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},prepare(sql){const statement=sqlite.prepare(sql);const bound=args=>({
  bind(...values){return bound(values);},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes)}};}
 });return bound([]);}};
}
