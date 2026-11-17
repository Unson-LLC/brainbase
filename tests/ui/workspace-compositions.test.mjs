import { describe, expect, it, vi } from 'vitest';
import { workspaceConditionChips, workspacePills, workspaceFormRow, workspaceCardRow, workspaceCardRowSkeleton, workspaceCheckbox, workspaceCombobox, workspaceDialogAppearance, workspaceDisclosure, workspaceInlineNotice, workspaceSelectionBar, workspaceStatusPill, workspaceRowMotion, workspaceInputFrame, workspaceDetailDrawer } from '../../ui/workspace-kit.js';
class ChildNodes extends Array { find=undefined; }
class Node {
  constructor(doc, tag) { this.ownerDocument=doc; this.tagName=tag.toUpperCase(); this.children=new ChildNodes(); this.attributes={}; this.listeners={}; this.style={setProperty:vi.fn()}; this.top=0; this.className=''; this.classList={add:n=>{this.className+=' '+n},remove:n=>{this.className=this.className.split(' ').filter(x=>x!==n).join(' ')}}; }
  prepend(...nodes) { this.children.unshift(...nodes); for (const node of nodes) node.parentNode=this; }
  querySelector(selector) { const [cls,child]=selector.split(' > '); const all=[]; const scan=n=>{for(const c of n.children){all.push(c);scan(c)}};scan(this); const found=all.find(n=>n.className.split(' ').includes(cls.slice(1))); return child ? Array.from(found?.children ?? []).find(n=>n.tagName===child.toUpperCase()) : found; }
  focus() { this.ownerDocument.activeElement=this; }
  showModal() { this.open=true; }
  close() { this.open=false; this.listeners.close?.({target:this}); }
  remove() { this.removed=true; if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(node=>node!==this); }
  get isConnected() { return !this.removed; }
  replaceChildren(...nodes) { this.children=new ChildNodes(); this.append(...nodes); }
  removeEventListener(k,v) { if(this.listeners[k]===v) delete this.listeners[k]; }

  append(...nodes) { for(const node of nodes) { this.children.push(node); if(node && typeof node==='object') node.parentNode=this; } }
  insertBefore(node, reference) { const index=this.children.indexOf(reference); if(index<0) return this.append(node); if(node.parentNode) node.remove(); this.children.splice(index,0,node); node.parentNode=this; return node; }
  setAttribute(k,v) { this.attributes[k]=String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
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
  it('opts a card into a soft selection and caller cell classes without changing defaults',()=>{
    const doc=document();const content=doc.createElement('time');
    const row=workspaceCardRow(doc,{selected:true,selectionAppearance:'soft',columnGap:16,cells:[{className:'fixture-date',content},'Alpha']});
    expect(row.className).toContain('bb-ws-card-row--soft-selected');
    expect(row.style.setProperty).toHaveBeenCalledWith('--bb-ws-card-column-gap','16px');
    expect(row.children[0].className).toBe('bb-ws-card-cell fixture-date');
    expect(row.children[0].children[0]).toBe(content);
  });
  it('opts a rich card row into the compact muted panel surface and preserves its stripe and content',()=>{
    const doc=document();const content=doc.createElement('section');
    const row=workspaceCardRow(doc,{appearance:'compact-panel',stripe:'var(--bb-color-border)',cells:[content]});
    expect(row.className).toContain('bb-ws-card-row--compact-panel');
    expect(row.style.setProperty).toHaveBeenCalledWith('--bb-card-stripe','var(--bb-color-border)');
    expect(row.children[0].children[0]).toBe(content);
    expect(workspaceCardRow(doc,{cells:[content]}).className).not.toContain('compact-panel');
  });
  it('keeps native disclosures closed by default and opts into compact sizing without changing the default',()=>{
    const doc=document(), content=doc.createElement('p'), changed=vi.fn();
    const standard=workspaceDisclosure(doc,{title:'Standard details',content});
    expect(standard.tagName).toBe('DETAILS');expect(standard.open).toBe(false);expect(standard.className).toBe('bb-ws-disclosure');
    expect(standard.children[0].children[0].tagName).toBe('H2');
    const compact=workspaceDisclosure(doc,{title:'More details',content,open:true,onToggle:changed,appearance:'compact',headingLevel:4});
    expect(compact.open).toBe(true);expect(compact.className).toBe('bb-ws-disclosure bb-ws-disclosure--compact');
    expect(compact.children[0].children[0].tagName).toBe('H4');expect(compact.children[1]).toBe(content);
    compact.open=false;compact.listeners.toggle({target:compact});expect(changed).toHaveBeenCalledWith(false);
  });
  it('accepts a shared combobox root directly as a selection-bar action',()=>{
    const doc=document();const combo=workspaceCombobox(doc,{label:'Destination',appearance:'compact',borderless:true,searchable:false,options:[{value:'a',label:'Alpha'}]});
    const bar=workspaceSelectionBar(doc,{count:1,actions:[combo.root],onDismiss:()=>{}});
    expect(bar.children[2].className).toBe('bb-ws-selection-bar-actions');
    expect(bar.children[2].children[0]).toBe(combo.root);
  });
  it('builds grouped compact options without including group headings in keyboard indices',()=>{
    const doc=document();
    const combo=workspaceCombobox(doc,{label:'Destination',appearance:'compact',borderless:true,popupAppearance:'control-panel',suggested:true,searchable:false,value:'alpha',options:[
      {value:'alpha',label:'Alpha',group:'Group A'},{value:'beta',label:'Beta',group:'Group A'},{value:'gamma',label:'Gamma',group:'Group B'},
    ],renderValue:option=>{const value=doc.createElement('span');value.textContent=`${option.group} · ${option.label}`;return value;}});
    expect(combo.root.className).toContain('bb-ws-combobox--borderless');
    expect(combo.root.className).toContain('bb-ws-combobox--control-panel');
    expect(combo.root.className).toContain('bb-ws-combobox--suggested');
    expect(combo.trigger.getAttribute('aria-label')).toBe('Destination: Group A・Alpha');
    combo.open();
    expect(combo.list.children.map(group=>group.getAttribute('role'))).toEqual(['group','group']);
    expect(combo.list.children[0].children[1].children.map(option=>option.getAttribute('role'))).toEqual(['option','option']);
    expect(combo.list.getAttribute('aria-activedescendant')).toContain('-option-0');
    combo.list.listeners.keydown({key:'ArrowDown',preventDefault:vi.fn(),stopPropagation:vi.fn()});
    expect(combo.list.getAttribute('aria-activedescendant')).toContain('-option-1');
    combo.update({suggested:false});
    expect(combo.root.className).not.toContain('bb-ws-combobox--suggested');
    expect(combo.trigger.children[0].className).toBe('bb-ws-combobox-value');
    combo.destroy();
  });
  it('keeps onChange change-only and reports every single-option selection through onSelect',()=>{
    const doc=document(),onChange=vi.fn(),onSelect=vi.fn();
    const combo=workspaceCombobox(doc,{label:'Destination',value:'same',searchable:false,options:[
      {value:'same',label:'Same value'},{value:'other',label:'Other value'},
    ],onChange,onSelect});
    combo.open();combo.list.children[0].click();
    expect(onChange).not.toHaveBeenCalled();expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenLastCalledWith('same',expect.objectContaining({label:'Same value'}));
    combo.open();combo.list.listeners.keydown({key:'ArrowDown',preventDefault:vi.fn(),stopPropagation:vi.fn()});
    combo.list.listeners.keydown({key:'Enter',preventDefault:vi.fn(),stopPropagation:vi.fn()});
    expect(onChange).toHaveBeenCalledOnce();expect(onChange).toHaveBeenLastCalledWith('other',expect.objectContaining({label:'Other value'}));
    expect(onSelect).toHaveBeenCalledTimes(2);expect(onSelect).toHaveBeenLastCalledWith('other',expect.objectContaining({label:'Other value'}));
    combo.destroy();
  });
  it('shares status, checkbox, selection, notice and skeleton surfaces',()=>{
    const doc=document();const changed=vi.fn(),dismiss=vi.fn();
    const status=workspaceStatusPill(doc,{label:'Ready',tone:'success',width:60});
    expect(status.className).toBe('bb-ws-status-pill is-success');expect(status.style.setProperty).toHaveBeenCalledWith('--bb-status-pill-width','60px');
    expect(workspaceStatusPill(doc,{label:'Pending',tone:'warning'}).className).toBe('bb-ws-status-pill is-warning');
    const checkbox=workspaceCheckbox(doc,{label:'Select all',checked:true,indeterminate:true,onChange:changed});
    expect(checkbox.tagName).toBe('INPUT');expect(checkbox.getAttribute('type')).toBe('checkbox');expect(checkbox.indeterminate).toBe(true);
    checkbox.checked=false;checkbox.indeterminate=false;checkbox.listeners.change();expect(changed).toHaveBeenCalledWith(false,false,checkbox);
    const action=doc.createElement('button');
    const bar=workspaceSelectionBar(doc,{count:3,actions:[action],onDismiss:dismiss});
    expect(bar.children[1].textContent).toBe('3件を選択中');expect(bar.children[1].getAttribute('aria-live')).toBeNull();
    expect(bar.children[2].children[0]).toBe(action);bar.children[0].click();expect(dismiss).toHaveBeenCalledOnce();
    const notice=workspaceInlineNotice(doc,{text:'Complete',tone:'success',icon:doc.createElement('svg'),action,onDismiss:dismiss});
    expect(notice.getAttribute('role')).toBe('status');expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.children[2].children[0]).toBe(action);expect(notice.children[2].children[1].children[0].getAttribute('class')).toBe('bb-ws-action-icon');
    const skeleton=workspaceCardRowSkeleton(doc,{columnGap:16,cells:['56px',{width:'100%',height:32}]});
    expect(skeleton.className).toContain('bb-ws-card-row--skeleton');expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.children).toHaveLength(2);expect(skeleton.children[1].children[0].style.setProperty).toHaveBeenCalledWith('--bb-card-skeleton-height','32px');
  });
  it('applies the compact confirmation appearance to a host-owned native dialog',()=>{
    const dialog=document().createElement('dialog');
    expect(workspaceDialogAppearance(dialog,{appearance:'confirmation',compactWidth:520})).toBe(dialog);
    expect(dialog.className).toContain('bb-ws-dialog--compact');expect(dialog.className).toContain('bb-ws-dialog--confirmation');
    expect(dialog.style.setProperty).toHaveBeenCalledWith('--bb-dialog-compact-width','520px');
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


describe('host-controlled unsaved form dismissal', () => {
  for (const [name, create] of [['drawer', workspaceDetailDrawer], ['input frame', workspaceInputFrame]]) {
    it(`keeps the ${name} open when the host vetoes close, X, or Escape`, () => {
      vi.useFakeTimers();
      try {
        const doc = document(true), onClose = vi.fn(), beforeClose = vi.fn(() => false);
        const frame = create(doc, { title: 'Fixture', onClose, beforeClose });
        frame.open();
        frame.close();
        frame.dialog.querySelector('.bb-ws-detail-closebar > button').click();
        const preventDefault = vi.fn();
        frame.dialog.listeners.cancel({ preventDefault });
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(beforeClose).toHaveBeenCalledTimes(3);
        expect(frame.dialog.open).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
        beforeClose.mockReturnValue(true);
        frame.close();
        expect(frame.dialog.open).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
        frame.open(); beforeClose.mockReturnValue(false); frame.dispose();
        expect(frame.dialog.isConnected).toBe(false);
        expect(frame.dialog.open).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally { vi.useRealTimers(); }
    });
  }

  it('applies quiet form appearance explicitly while retaining required labels and controls', () => {
    const doc = document(), input = doc.createElement('input'); input.id = 'fixture-quiet-title';
    const onInput = vi.fn(); input.addEventListener('input', onInput);
    const row = workspaceFormRow(doc, { label: 'Title', control: input, required: true, appearance: 'quiet' });
    expect(row.className).toContain('is-quiet');
    expect(row.children[0].getAttribute('for')).toBe(input.id);
    expect(row.children[1]).toBe(input);
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.listeners.input).toBe(onInput);
    expect(workspaceFormRow(doc, { label: 'Default' }).className).not.toContain('is-quiet');
  });
});
