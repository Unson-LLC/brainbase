#!/usr/bin/env node
// Runs only against a newly created, disposable PostgreSQL cluster.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import { InfoSSOTService } from '../server/services/info-ssot-service.js';
import { PortableGraphService } from '../server/services/portable-graph-service.js';
import { createInfoSSOTRouter } from '../server/routes/info-ssot.js';
import { retrievePortableGraph, portableGraphDigest } from '../vendor/brainbase-oss-graph/portable-graph.js';

const scratch = process.argv[2];
if (!scratch || !resolve(scratch).startsWith('/Volumes/')) throw new Error('Pass an external /Volumes scratch directory');
const bin = process.env.PORTABLE_TEST_PG_BIN || '/usr/local/opt/postgresql@16/bin';
const root = await mkdtemp(join(resolve(scratch), 'portable-pg-'));
const socket = join(root, 'sock'); await mkdir(socket);
// AF_UNIX paths must be short; use a task-owned /tmp symlink only for the socket.
const { symlink, unlink } = await import('node:fs/promises');
const socketLink = '/tmp/bb-pg-' + process.pid;
await symlink(socket, socketLink);
const data = join(root, 'data');
let started = false, admin, pool, server;
const pg = (cmd, args) => execFileSync(join(bin, cmd), args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
try {
    pg('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'portable_test_admin']);
    pg('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socketLink} -h '' -p 55482`, '-w', 'start']);
    started = true;
    admin = new Pool({ host: socketLink, port: 55482, user: 'portable_test_admin', database: 'postgres' });
    await admin.query(`CREATE TABLE projects (id text PRIMARY KEY, code text UNIQUE, organization_id text);
        INSERT INTO projects VALUES ('p1','project-a','org-a'),('p2','project-b','org-b');
        CREATE ROLE portable_test_app LOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT SELECT ON projects TO portable_test_app;`);
    await admin.query(await readFile(new URL('../server/sql/portable-graph-schema.sql', import.meta.url), 'utf8'));
    await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON portable_graph_snapshots TO portable_test_app');
    pool = new Pool({ host: socketLink, port: 55482, user: 'portable_test_app', database: 'postgres' });
    const info = new InfoSSOTService({ pool });
    const service = new PortableGraphService(info);
    const access = { authSource:'bearer', organizationId:'org-a', personId:'alice', role:'member', projectCodes:['project-a'], clearance:['internal'] };
    const bundle = JSON.parse(await readFile(new URL('../tests/fixtures/portable-graph/bundle.json', import.meta.url), 'utf8'));
    const key = 'snapshot-1';
    assert.equal((await service.import(access, 'project-a', key, bundle)).status, 'imported');
    assert.equal((await service.import(access, 'project-a', key, bundle)).status, 'unchanged');
    assert.deepEqual((await service.read(access, 'project-a', key)).bundle, bundle);
    const changed = structuredClone(bundle); changed.graph.entities[0].name = 'Changed';
    await assert.rejects(service.import(access, 'project-a', key, changed), e => e.status === 409);
    const input = {query:'判断基準',asOf:'2026-08-17T00:00:00.000Z',seedIds:['person-tanaka-atlas'],steps:[{relation:'accountable_for',direction:'outgoing'},{relation:'governs',direction:'incoming',targetType:'decision'}]};
    const local = await retrievePortableGraph(bundle, input);
    assert.equal(local.results[0].id, 'decision-user-outcome');
    assert.deepEqual(await service.search(access, 'project-a', key, input), {...local, authority:'organization_graph'});
    assert.deepEqual(await service.search(access, 'project-a', key, {query:'判断',asOf:input.asOf}), {...await retrievePortableGraph(bundle,{query:'判断',asOf:input.asOf}),authority:'organization_graph'});
    await assert.rejects(service.read({...access,personId:'bob'},'project-a',key), e=>e.status===404);
    await assert.rejects(service.read({...access,organizationId:'org-b'},'project-a',key), e=>e.status===403);
    await assert.rejects(service.read({...access,projectCodes:[]},'project-a',key), e=>e.status===403);
    await assert.rejects(service.read({...access,authSource:'cookie'},'project-a',key), e=>e.status===403);
    await service.import({...access,personId:'bob'},'project-a',key,changed);
    assert.deepEqual((await service.read(access,'project-a',key)).bundle,bundle);
    // Direct SQL confirms the RLS boundary, independent of service WHERE clauses.
    for (const denied of [{...access,personId:'mallory'},{...access,organizationId:'org-b'},{...access,projectCodes:['project-b']}]) {
        await info.withAccessContext(denied,async client=>{
            await client.query("SELECT set_config('app.portable_graph_owner',$1,true)",[denied.personId]);
            assert.equal((await client.query('SELECT * FROM portable_graph_snapshots')).rows.length,0);
        },{requireCanonicalTenant:true});
        await assert.rejects(info.withAccessContext(denied,async client=>{
            await client.query("SELECT set_config('app.portable_graph_owner',$1,true)",[denied.personId]);
            await client.query('INSERT INTO portable_graph_snapshots (organization_id,project_code,owner_person_id,graph_id,bundle,digest) VALUES ($1,$2,$3,$4,$5,$6)', ['org-a','project-a','alice','forbidden',bundle,portableGraphDigest(bundle)]);
        },{requireCanonicalTenant:true}),e=>e.code==='42501');
    }
    await info.withAccessContext(access,async client=>{
        await client.query("SELECT set_config('app.portable_graph_owner',$1,true)",[access.personId]);
        assert.equal((await client.query("UPDATE portable_graph_snapshots SET digest=digest RETURNING graph_id")).rows.length,0);
        assert.equal((await client.query("DELETE FROM portable_graph_snapshots RETURNING graph_id")).rows.length,0);
    },{requireCanonicalTenant:true});
    // Actual routing/controller/readback; auth middleware is a test principal injector.
    const app=express(); app.use(express.json({limit:'10mb'}));
    app.use((req,_res,next)=>{req.authSource=req.headers.authorization==='Bearer test-owner'?'bearer':'cookie';req.access=access;next();});
    app.use('/api/info',createInfoSSOTRouter(info));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}/api/info/graph/portable/${key}`;
    let response=await fetch(base+'?project_code=project-a',{headers:{authorization:'Bearer test-owner'}});
    assert.deepEqual(await response.json(),{bundle,digest:portableGraphDigest(bundle)});
    response=await fetch(base+'/search',{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:JSON.stringify({project_code:'project-a',input})});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{...local,authority:'organization_graph'});
    response=await fetch(base+'?project_code=project-a');assert.notEqual(response.status,200);
    if (process.argv[3]) {
        const oss = resolve(process.argv[3]);
        const fixtureDir=join(root,'oss-source');await mkdir(fixtureDir);
        const sources={'graph.json':JSON.stringify(bundle.graph),'relationships.json':JSON.stringify({version:1,relationships:[]}),
            'personal-kg.jsonl':'','decisions.jsonl':bundle.decisions.map(d=>JSON.stringify(d)).join('\n')+'\n'};
        for(const [file,text] of Object.entries(sources)) await writeFile(join(fixtureDir,file),text);
        Object.assign(process.env,{BRAINBASE_ORGANIZATION_URL:`http://127.0.0.1:${server.address().port}`,
            BRAINBASE_ORGANIZATION_TOKEN:'test-owner',BRAINBASE_ORGANIZATION_PROJECT:'project-a',BRAINBASE_ORGANIZATION_GRAPH_ID:'cli-snapshot'});
        const {runCli}=await import(pathToFileURL(join(oss,'dist/cli.js')));
        let output='';const io={stdout:{write:t=>{output+=t;return true;}},stderr:{write:t=>{output+=t;return true;}}};
        assert.equal(await runCli(['graph:upgrade','--dir',fixtureDir],io),0,output);
        assert.equal(JSON.parse(output).readbackVerified,true);
        for(const [file,text] of Object.entries(sources)) assert.equal(await readFile(join(fixtureDir,file),'utf8'),text);
        const {callBrainbaseTool}=await import(pathToFileURL(join(oss,'dist/server.js')));
        assert.deepEqual(await callBrainbaseTool('search',{...input,dataDir:join(root,'nonexistent-local')}),{...local,authority:'organization_graph'});
        console.log('PASS: actual OSS CLI import/readback, unchanged source files, actual OSS MCP search using organization HTTP backend');
    }
    // Verify every committed vendor artifact against its source lock.
    const lock=JSON.parse(await readFile(new URL('../vendor/brainbase-oss-graph/source-lock.json',import.meta.url),'utf8'));
    for(const [file,entry] of Object.entries(lock.files)) assert.equal(createHash('sha256').update(await readFile(new URL('../vendor/brainbase-oss-graph/'+file,import.meta.url))).digest('hex'),entry.sha256);
    await new Promise(resolve=>server.close(resolve));server=null;
    await pool.end();pool=null;await admin.end();admin=null;
    pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;
    pg('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socketLink} -h '' -p 55482`,'-w','start']);started=true;
    pool=new Pool({host:socketLink,port:55482,user:'portable_test_app',database:'postgres'});
    assert.deepEqual((await new PortableGraphService(new InfoSSOTService({pool})).read(access,'project-a',key)).bundle,bundle);
    console.log('PASS: persisted graph survives PostgreSQL restart');
    console.log('PASS: real PostgreSQL owner/org/project RLS, immutable import, exact bundle readback, shared search, HTTP routes, vendor hashes');
} finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await pool?.end(); await admin?.end();
    if(started) pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    await unlink(socketLink); await rm(root,{recursive:true,force:true});
}
