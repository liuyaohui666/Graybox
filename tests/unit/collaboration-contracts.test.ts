import {test,expect} from 'vitest';
import {commandSchema} from '../../packages/contracts/src/index.ts';
import {randomUUID} from 'node:crypto';
test('independent idea commands validate strict revision and identity',()=>{
 const base={batch_id:randomUUID(),idempotency_key:randomUUID(),type:'idea_create',payload:{name:'Independent',body:'Research',project_id:null}};
 expect(commandSchema.safeParse(base).success).toBe(true);
 expect(commandSchema.safeParse({...base,payload:{...base.payload,owner_id:randomUUID()}}).success).toBe(false);
 expect(commandSchema.safeParse({...base,type:'idea_update',payload:{id:randomUUID(),body:'next'}}).success).toBe(false);
});
