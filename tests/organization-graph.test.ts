import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { createFixturePersonalOs } from './fixtures.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrganizationGraphConfig, createOrganizationGraphClient } from '../src/organization-graph.js';
import { portableGraphDigest, retrievePortableGraph, type PortableGraphBundle } from '../src/portable-graph.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';
import { callBrainbaseTool } from '../src/server.js';

const bundle:PortableGraphBundle={schemaVersion:1,graph:canonicalResolutionGraph,decisions:[{id:'decision-user-outcome',title:'判断',decision:'成果を確認',rationale:'根拠を分ける'}]};
const config={url:'https://example.test',token:'private-test-token',projectCode:'authorized-project',graphId:'snapshot'};
const input={query:'判断',asOf:'2026-08-17T00:00:00.000Z',seedIds:['project-atlas'],steps:[{relation:'governs' as const,direction:'incoming' as const}]};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('optional organization backend',()=>{
  it('requires complete configuration and rejects unsafe endpoints',()=>{
    expect(createOrganizationGraphConfig({})).toBeUndefined();
    expect(()=>createOrganizationGraphConfig({BRAINBASE_ORGANIZATION_URL:config.url})).toThrow('all organization settings');
    expect(()=>createOrganizationGraphClient({...config,url:'http://example.test'})).toThrow();
    expect(()=>createOrganizationGraphClient({...config,url:'https://user:secret@example.test'})).toThrow();
  });
  it('forwards the same search input and preserves graph evidence',async()=>{
    const expected={...await retrievePortableGraph(bundle,input),authority:'organization_graph' as const};
    const fetch=vi.fn(async()=>new Response(JSON.stringify(expected),{status:200}));
    const result=await createOrganizationGraphClient({...config,fetch}).search(input);
    expect(result).toEqual(expected);
    const [url,request]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://example.test/api/info/graph/portable/snapshot/search');
    expect(JSON.parse(request.body as string)).toEqual({project_code:'authorized-project',input});
    expect(request.redirect).toBe('error');
  });
  it('verifies the imported and returned bundle digests',async()=>{
    const digest=portableGraphDigest(bundle);
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({status:'imported',digest})))
      .mockResolvedValueOnce(new Response(JSON.stringify({bundle,digest})));
    const client=createOrganizationGraphClient({...config,fetch});
    expect(await client.importPortableGraph(bundle)).toEqual({status:'imported',digest});
    expect(await client.readPortableGraph()).toEqual({bundle,digest});
    await expect(createOrganizationGraphClient({...config,fetch:async()=>new Response(JSON.stringify({bundle,digest:'sha256:wrong'}))}).readPortableGraph()).rejects.toThrow('readback_mismatch');
    await expect(client.importPortableGraph({...bundle,personalKg:[]})).rejects.toThrow('unknown top-level');
  });
  it('upgrades through the CLI with verified readback and unchanged source files',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'portable-cli-'));
    try {
      await createFixturePersonalOs(dir);
      await writeFile(join(dir,'graph.json'),JSON.stringify(bundle.graph));
      await writeFile(join(dir,'decisions.jsonl'),bundle.decisions.map(d=>JSON.stringify(d)).join('\n')+'\n');
      const files=['graph.json','decisions.jsonl','personal-kg.jsonl','relationships.json'];
      const before=await Promise.all(files.map(file=>readFile(join(dir,file),'utf8')));
      vi.stubEnv('BRAINBASE_ORGANIZATION_URL',config.url);vi.stubEnv('BRAINBASE_ORGANIZATION_TOKEN',config.token);
      vi.stubEnv('BRAINBASE_ORGANIZATION_PROJECT',config.projectCode);vi.stubEnv('BRAINBASE_ORGANIZATION_GRAPH_ID',config.graphId);
      let uploaded:PortableGraphBundle;
      vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
        if(init.method==='POST') {
          uploaded=JSON.parse(init.body).bundle;
          return new Response(JSON.stringify({status:'imported',digest:portableGraphDigest(uploaded)}));
        }
        return new Response(JSON.stringify({bundle:uploaded,digest:portableGraphDigest(uploaded)}));
      }));
      let output='';const io={stdout:{write:(t:string)=>{output+=t;return true;}},stderr:{write:(t:string)=>{output+=t;return true;}}};
      expect(await runCli(['graph:upgrade','--dir',dir],io)).toBe(0);
      expect(JSON.parse(output).readbackVerified).toBe(true);
      expect(await Promise.all(files.map(file=>readFile(join(dir,file),'utf8')))).toEqual(before);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('rejects authorization failures, redirects, malformed responses and deadlines',async()=>{
    for(const status of [401,403,302,500]) {
      await expect(createOrganizationGraphClient({...config,fetch:async()=>new Response('{}',{status})}).search(input)).rejects.toThrow(/organization_graph_/);
    }
    await expect(createOrganizationGraphClient({...config,fetch:async()=>new Response('{}')}).search(input)).rejects.toThrow('response_invalid');
    await expect(createOrganizationGraphClient({...config,timeoutMs:10,fetch:()=>new Promise(()=>{})}).search(input)).rejects.toThrow('timeout');
  });
  it('does not read the local corpus or fall back when organization search fails',async()=>{
    vi.stubEnv('BRAINBASE_ORGANIZATION_URL',config.url);vi.stubEnv('BRAINBASE_ORGANIZATION_TOKEN',config.token);
    vi.stubEnv('BRAINBASE_ORGANIZATION_PROJECT',config.projectCode);vi.stubEnv('BRAINBASE_ORGANIZATION_GRAPH_ID',config.graphId);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:403})));
    await expect(callBrainbaseTool('search',{...input,dataDir:'/does-not-exist'})).rejects.toThrow('unauthorized');
  });
});
