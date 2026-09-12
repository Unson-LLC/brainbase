// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PortableGraphService } from '../../../server/services/portable-graph-service.js';
import { retrievePortableGraph } from '../../../vendor/brainbase-oss-graph/portable-graph.js';

const access={authSource:'bearer',organizationId:'org-a',personId:'alice',role:'member',projectCodes:['project-a'],clearance:['internal']};
const bundle=JSON.parse(await readFile(new URL('../../fixtures/portable-graph/bundle.json',import.meta.url),'utf8'));
describe('owner-private portable graph',()=>{
    it('rejects unsigned owners and unauthorized projects before opening a transaction',async()=>{
        const info={withAccessContext:vi.fn()}; const service=new PortableGraphService(info);
        for(const denied of [{...access,authSource:'cookie'},{...access,personId:null},{...access,organizationId:null},{...access,projectCodes:[]},{...access,tenantId:'other'}]) {
            await expect(service.read(denied,'project-a','one')).rejects.toMatchObject({status:403});
        }
        expect(info.withAccessContext).not.toHaveBeenCalled();
    });
    it('executes the same search kernel including semantic providers and missing evidence',async()=>{
        const provider={id:'fixture',embed:vi.fn(async texts=>texts.map(()=>[1,0]))};
        const service=new PortableGraphService({}, {provider});service.read=vi.fn(async()=>({bundle}));
        for(const input of [{query:'判断',asOf:'2026-08-17T00:00:00.000Z'},
            {query:'判断',asOf:'2026-08-17T00:00:00.000Z',seedIds:['project-atlas'],steps:[{relation:'governs',direction:'incoming'}]}]) {
            const expected=await retrievePortableGraph(bundle,input,input.seedIds?undefined:provider);
            expect(await service.search(access,'project-a','one',input)).toEqual({...expected,authority:'organization_graph'});
        }
        expect(provider.embed).toHaveBeenCalled();
    });
    it('locks the vendored kernel to verified public artifacts',async()=>{
        const root=new URL('../../../vendor/brainbase-oss-graph/',import.meta.url);
        const lock=JSON.parse(await readFile(new URL('source-lock.json',root),'utf8'));
        expect(lock.repository).toBe('https://github.com/Unson-LLC/brainbase');
        for(const [file,entry] of Object.entries(lock.files)) {
            expect(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex')).toBe(entry.sha256);
        }
    });
});
