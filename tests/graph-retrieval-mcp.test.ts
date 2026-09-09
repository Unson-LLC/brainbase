import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callBrainbaseTool } from '../src/server.js';
import { createFixturePersonalOs } from './fixtures.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive:true,force:true}))); });
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'brainbase-retrieval-')); dirs.push(dir);
  await createFixturePersonalOs(dir);
  await writeFile(join(dir,'graph.json'),JSON.stringify(canonicalResolutionGraph));
  await writeFile(join(dir,'decisions.jsonl'),JSON.stringify({id:'decision-user-outcome', title:'成果の確認',decision:'実測と利用者成果を分ける',rationale:'計測値だけでは利用者に役立ったと判断できないため'})+'\n');
  return dir;
}
describe('graph retrieval MCP',()=>{
  it('follows a real relation without an embedding API through actual stdio',async()=>{
    const dir=await fixture();
    const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>!key.startsWith('BRAINBASE_EMBEDDING_') && value!==undefined)) as Record<string,string>;
    const client=new Client({name:'retrieval-contract',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js'],env:{...env,BRAINBASE_PERSONAL_OS_DIR:dir}}));
    try {
      const response=await client.callTool({name:'search',arguments:{query:'Atlasで守る判断と理由',limit:1,seedIds:['project-atlas'],steps:[{relation:'governs',direction:'incoming',targetType:'decision'}]}});
      expect(response.isError).not.toBe(true);
      const text=response.content[0];
      const result=JSON.parse(text.type==='text'?text.text:'{}');
      expect(result.absenceConfirmed).toBe(false);
      expect(result.results).toEqual(expect.arrayContaining([expect.objectContaining({id:'decision-user-outcome',relationPath:[canonicalResolutionGraph.edges[2].id]})]));
      expect(JSON.stringify(result)).toContain('計測値だけでは利用者に役立ったと判断できないため');
      expect(JSON.stringify(result)).toContain('needs_model_verification');
    } finally {await client.close();}
  });
  it('rejects unknown relations and mode bypass before searching',async()=>{
    const dataDir=await fixture();
    await expect(callBrainbaseTool('search',{dataDir,query:'Atlas',steps:[{relation:'invented',direction:'incoming'}]})).rejects.toThrow();
    await expect(callBrainbaseTool('search',{dataDir,query:'Atlas',mode:'lexical'})).rejects.toThrow();
  });
});
