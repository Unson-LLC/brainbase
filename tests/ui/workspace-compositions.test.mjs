import { describe, expect, it, vi } from 'vitest';
import { workspaceConditionChips, workspacePills, workspaceFormRow, workspaceCardRow, workspaceRowMotion, workspaceInputFrame } from '../../ui/workspace-kit.js';
class Node {
  constructor(doc, tag) { this.ownerDocument=doc; this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.listeners={}; this.style={setProperty:vi.fn()}; this.top=0; this.className=''; this.classList={add:n=>{this.className+=' '+n},remove:n=>{this.className=this.className.split(' ').filter(x=>x!==n).join(' ')}}; }
  prepend(...nodes) { this.children.unshift(...nodes); }
  querySelector(selector) { const [cls,child]=selector.split(' > '); const all=[]; const scan=n=>{for(const c of n.children){all.push(c);scan(c)}};scan(this); const found=all.find(n=>n.className.split(' ').includes(cls.slice(1))); return child ? found?.children.find(n=>n.tagName===child.toUpperCase()) : found; }
  focus() { this.ownerDocument.activeElement=this; }
  showModal() { this.open=true; }
  close() { this.open=false; this.listeners.close?.({target:this}); }
  remove() { this.removed=true; }
  get isConnected() { return !this.removed; }
  replaceChildren(...nodes) { this.children=nodes; }
  removeEventListener(k,v) { if(this.listeners[k]===v) delete this.listeners[k]; }

  append(...nodes) { this.children.push(...nodes); }
  setAttribute(k,v) { this.attributes[k]=String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(k,v) { this.listeners[k]=v; }
  click() { this.listeners.click?.({currentTarget:this}); }
  getBoundingClientRect() { return {top:this.top}; }
  querySelectorAll() { return this.children; }
}
const document = (reduce=false) => { const doc={createElement:tag=>new Node(doc,tag), createElementNS:(_,tag)=>new Node(doc,tag),defaultView:{matchMedia:()=>({matches:reduce}),getComputedStyle:()=>({getPropertyValue:k=>k==='--bb-row-move-duration'?'320ms':'cubic-bezier(.2,.8,.2,1)'})}};doc.body=doc.createElement("body");return doc; };
describe('business-neutral workspace compositions',()=>{
  it('keeps condition removal and reset under the host, with accessible names',()=>{
    const remove=vi.fn(),reset=vi.fn();const root=workspaceConditionChips(document(),{items:[{label:'Synthetic condition',onRemove:remove}],reset});
    root.children[0].children[1].click();root.children[1].click();expect(remove).toHaveBeenCalledOnce();expect(reset).toHaveBeenCalledOnce();
    expect(root.children[0].children[1].getAttribute('aria-label')).toBe('Synthetic conditionを解除');
    expect(workspaceConditionChips(document()).children).toHaveLength(0);
  });
  it('reports pill choices without silently taking ownership of state',()=>{
    const onChange=vi.fn();const root=workspacePills(document(),{label:'Mode',items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta',disabled:true}],value:'a',onChange});
    root.children[0].click();expect(onChange).toHaveBeenCalledWith('a',{value:'a',label:'Alpha'});
    expect(root.children[1].getAttribute('disabled')).toBe('');root.update('b');expect(root.children[1].getAttribute('aria-pressed')).toBe('true');
  });
  it('associates required inputs and leaves host handlers and input identity intact',()=>{
    const doc=document();const input=doc.createElement('input');input.id='synthetic-title';const onInput=vi.fn();input.addEventListener('input',onInput);
    const row=workspaceFormRow(doc,{label:'Title',control:input,required:true});expect(row.children[0].getAttribute('for')).toBe(input.id);expect(input.required).toBe(true);expect(input.getAttribute('aria-required')).toBe('true');expect(row.children[1]).toBe(input);expect(input.listeners.input).toBe(onInput);
  });
  it('lets the host define stripe, columns, selection and content without business defaults',()=>{
    const onSelect=vi.fn();const row=workspaceCardRow(document(),{key:'fixture-a',stripe:'var(--bb-color-mint)',selected:true,cells:['Alpha',null],onSelect});row.click();expect(onSelect).toHaveBeenCalledWith('fixture-a');expect(row.style.setProperty).toHaveBeenCalledWith('--bb-card-stripe','var(--bb-color-mint)');expect(row.getAttribute('aria-pressed')).toBe('true');expect(row.children[1].textContent).toBe('');
  });
  it('moves keyed redrawn rows, skips new rows, cancels running movement and respects reduced motion',()=>{
    const doc=document();const root=doc.createElement('div');const row=workspaceCardRow(doc,{key:'a'});row.top=10;root.append(row);const motion=workspaceRowMotion(root);motion.capture();const replacement=workspaceCardRow(doc,{key:'a'});replacement.top=70;const animation={cancel:vi.fn()};replacement.animate=vi.fn(()=>animation);const added=workspaceCardRow(doc,{key:'b'});added.animate=vi.fn();root.children=[replacement,added];motion.play();expect(replacement.animate).toHaveBeenCalledWith([{transform:'translateY(-60px)'},{transform:'none'}],{duration:320,easing:'cubic-bezier(.2,.8,.2,1)'});expect(added.animate).not.toHaveBeenCalled();motion.destroy();expect(animation.cancel).toHaveBeenCalledOnce();
    const reducedDoc=document(true);const reducedRoot=reducedDoc.createElement('div');const reduced=workspaceCardRow(reducedDoc,{key:'a'});reduced.animate=vi.fn();reducedRoot.append(reduced);const controller=workspaceRowMotion(reducedRoot);controller.capture();reduced.top=90;controller.play();expect(reduced.animate).not.toHaveBeenCalled();
  });
});

it('composes a frame while retaining the drawer dismissal and opener lifecycle',()=>{
  vi.useFakeTimers();try {
    const doc=document();const opener=doc.createElement('button');const onClose=vi.fn();
    const frame=workspaceInputFrame(doc,{title:'Alpha',opener,onClose,rows:[workspaceFormRow(doc,{label:'Name',control:doc.createElement('input')})]});
    expect(frame.dialog.open).toBeUndefined();frame.open();expect(frame.dialog.open).toBe(true);
    frame.setTitle('Beta');expect(frame.top.children[0].textContent).toBe('Beta');
    frame.dialog.listeners.cancel({preventDefault:vi.fn()});expect(onClose).toHaveBeenCalledOnce();expect(frame.dialog.open).toBe(true);
    frame.dialog.listeners.animationend({target:frame.dialog,animationName:'bb-ws-input-frame-out'});
    expect(frame.dialog.open).toBe(false);expect(doc.activeElement).toBe(opener);
    frame.setContent(doc.createElement('div'));expect(frame.dialog.open).toBe(false);frame.dispose();expect(frame.dialog.isConnected).toBe(false);expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
