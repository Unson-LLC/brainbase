const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const scriptPath = "../docs/manual/public/marketing-analytics.js";
const original = fs.readFileSync(path.join(__dirname, scriptPath), 'utf8');
const config = JSON.parse(original.match(/const config = (\{[\s\S]*?\});/)[1]);
function setup({enabled = true, ready = true, stored = null, duplicate = false, host = config.hosts[0], route = '/'} = {}) {
  const listeners = {};
  const scripts = [];
  const storage = new Map(stored ? [['marketing_analytics_consent_v1', stored]] : []);
  function element(tag) {
    return {tag, children: [], events: {}, style: {}, hidden: false,
      setAttribute() {}, appendChild(e) {this.children.push(e)},
      addEventListener(n, cb) {this.events[n] = cb}};
  }
  const body = element('body');
  const document = {referrer:'https://www.google.com/search?q=private%40example.com',body,
    head:{appendChild(e) {scripts.push(e)}}, createElement:element,
    querySelector() {return duplicate ? {} : null},
    addEventListener(n, cb) {listeners[n] = cb}};
  const window = {setInterval(cb) {this.tick = cb}};
  const location = {hostname:host, pathname:route, origin:'https://'+host, search:'?email=private@example.com', href:'https://'+host+route+'?email=private@example.com'};
  const cfg = {...config, id:config.id || 'G-TEST12345', enabled, enhancedMeasurementDisabled:ready};
  const code = original.replace(/const config = \{[\s\S]*?\};/, 'const config = '+JSON.stringify(cfg)+';');
  vm.runInNewContext(code,{window,document,location,URL,Date,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  const calls = () => Array.from(window.dataLayer || [], args=>Array.from(args));
  const grant = () => body.children[0].children[1].events.click();
  const deny = () => body.children[0].children[2].events.click();
  const click = href => listeners.click({target:{closest:()=>({getAttribute:()=>href})}});
  const lead = detail => listeners['marketing:lead-success']({detail});
  return {scripts,body,window,location,storage,calls,grant,deny,click,lead};
}
test('checked-in activation is off and remote settings are not assumed',()=>{
  assert.equal(config.enabled,false); assert.equal(config.enhancedMeasurementDisabled,false);
});
test('disabled / missing remote settings / duplicate / wrong host do nothing',()=>{
  for (const opts of [{enabled:false},{ready:false},{duplicate:true},{host:'bb-app.unson.jp'}]) {
    const app=setup(opts); assert.equal(app.scripts.length,0); assert.equal(app.body.children.length,0);
  }
});
test('before consent no Google script, queue or click/lead events',()=>{
  const app=setup(); app.click('https://service.zeims.ai/?email=secret'); app.lead({email:'secret'});
  assert.equal(app.scripts.length,0); assert.equal(app.calls().length,0);
});
test('accept once: one loader, one page view, ad consent denied, private URLs excluded',()=>{
  const app=setup();app.grant();app.grant();app.window.tick();
  assert.equal(app.scripts.length,1);assert.equal(app.scripts[0].referrerPolicy,'no-referrer');
  assert.equal(app.calls().filter(c=>c[0]==='event'&&c[1]==='page_view').length,1);
  const cfg=app.calls().find(c=>c[0]==='config')[2];assert.equal(cfg.send_page_view,false);assert.equal(cfg.allow_google_signals,false);
  assert.equal(cfg.cookie_expires,2592000);assert.equal(cfg.page_referrer,'');
  const serialized=JSON.stringify(app.calls());assert.ok(!serialized.includes('private'));assert.ok(!serialized.includes('?'));
});
test('query / unknown routes and arbitrary event details never enter payloads',()=>{
  const app=setup();app.grant();app.lead({email:'private@example.com',message:'tax details',url:app.location.href});
  app.lead({});assert.equal(app.calls().filter(c=>c[1]==='generate_lead').length,1);
  app.location.pathname='/accounts/customer-private';app.window.tick();const before=app.calls().length;
  app.lead({});app.click('https://timerex.net/private?token=secret');assert.equal(app.calls().length,before);
  assert.ok(!JSON.stringify(app.calls()).includes('customer-private'));assert.ok(!JSON.stringify(app.calls()).includes('tax details'));
});
test('withdrawal suppresses later events; renewed consent resumes safely',()=>{
  const app=setup();app.grant();app.deny();app.click('https://timerex.net/?token=secret');
  assert.equal(app.window['ga-disable-'+(config.id||'G-TEST12345')],true);
  assert.equal(app.calls().filter(c=>c[0]==='event').length,0);
  app.grant();assert.equal(app.window['ga-disable-'+(config.id||'G-TEST12345')],false);
  assert.equal(app.calls().filter(c=>c[1]==='page_view').length,1);
});
test('stored consent loads only on public allowlisted routes',()=>{
  assert.equal(setup({stored:'granted'}).scripts.length,1);
  assert.equal(setup({stored:'granted',route:'/private/customer-1'}).scripts.length,0);
});
test('CTA classification sends fixed values only; clicks never claim completion',()=>{
  const app=setup();app.grant();
  app.click('https://timerex.net/company/person?token=secret');
  app.click('https://web.zeims.ai/register?email=private@example.com');
  app.click('https://service.zeims.ai/2026-05?customer=secret');
  const events=app.calls().filter(c=>c[0]==='event');
  assert.ok(events.some(c=>c[1]==='inquiry_click'));
  assert.ok(events.some(c=>c[1]==='trial_click'));
  assert.ok(!events.some(c=>c[1]==='generate_lead'));
  assert.ok(!JSON.stringify(events).includes('secret'));assert.ok(!JSON.stringify(events).includes('private'));
});
