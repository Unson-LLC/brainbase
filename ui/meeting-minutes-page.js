/* Opt-in meeting page presentation. The existing screen owns HTTP and mutations. */
import {
  makeWorkspaceElement as element, workspaceButton as button, workspaceTopbar,
  workspaceActionIcon, workspaceTabStrip, workspaceConditionChips,
  workspaceControlRow, workspaceCombobox, workspaceFilterPopover,
  workspaceCardRow, workspaceRowMotion,
} from './workspace-kit.js?capability=search-band-v1';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const VIEWS = [['recommend', 'おすすめ'], ['joined', '自分が出た会議'], ['waiting', '確認待ち'], ['all', 'すべて']];
const SORTS = [
  { value: 'pending-first', label: '確認待ちを先に' },
  { value: 'scheduled-desc', label: '会議が新しい順' },
  { value: 'scheduled-asc', label: '会議が古い順' },
  { value: 'updated-desc', label: '議事録の更新が新しい順' },
];
const n = (doc, tag, cls, text, attrs) => element(doc, tag, { className: cls, text, attrs });
export function minutesDay(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function minutesListState(entry) {
  const docs = Array.isArray(entry?.minutes) ? entry.minutes.filter(d => !d.withdrawal) : [];
  if (!docs.length) return null;
  const summaries = Array.isArray(entry?.current_version_states) ? entry.current_version_states : null;
  const states = docs.map(d => {
    if (summaries) {
      const item = summaries.find(v => v.minutes_id === d.minutes_id && v.version_id === d.current_version_id);
      return ['pending', 'confirmed'].includes(item?.status) ? item.status : 'unknown';
    }
    const versions = [...(entry.versions ?? []), ...(d.versions ?? [])];
    const v = versions.find(v => v.version_id === d.current_version_id);
    if (!v) return 'unknown';
    if (v.confirmation && typeof v.confirmation.actor_id === 'string' && typeof v.confirmation.confirmed_at === 'string') return 'confirmed';
    return v.confirmation === undefined || v.confirmation === null ? 'pending' : 'unknown';
  });
  if (states.includes('pending')) return { code: 'pending', label: '確認待ち' };
  if (states.every(s => s === 'confirmed')) return { code: 'confirmed', label: '確認済み' };
  return null;
}
export function minutesDateCell(doc, meeting, now) {
  const day = minutesDay(meeting.scheduled_at);
  if (!day) return n(doc, 'span', 'mp-nodate', '日時なし');
  const date = new Date(`${day}T12:00:00+09:00`);
  const root = n(doc, 'span', `mp-date${day === minutesDay(now) ? ' is-today' : ''}`);
  root.append(n(doc, 'b', '', day.slice(5).replace('-', '/')), n(doc, 'i', '', WD[date.getUTCDay()]));
  if (day === minutesDay(now)) root.title = '今日';
  return root;
}
export function minutesConfirmation(doc, value) {
  return n(doc, 'span', value ? `mp-confirm is-${value.code}` : 'mp-unknown', value?.label ?? '未確認');
}

export function createMinutesPage({ doc, state, screen, toolbar, listPane, keyword, clock,
  hostFilters, principalIds, projectContext, sortMeetings, matchesFilters, listState,
  versionNumber, onRender, onCreate, canCreate, appendCreateUnavailable, onOpen }) {
  let view = 'recommend', mine = true, noDate = false, period = '', sort = 'pending-first';
  let month = minutesDay(clock()).slice(0, 7), rangeStart = '';
  const boxes = [], projectBoxes = new Map();
  const tabs = n(doc, 'div', '', '', { role: 'tablist', 'aria-label': '議事録の見方' });
  const tabButtons = VIEWS.map(([value, label]) => {
    const b = button(doc, { text: label, attrs: { role: 'tab', 'aria-selected': String(value === view) }, onClick: () => chooseView(value) });
    b.append(n(doc, 'b', 'bb-ws-tab-count', '0')); tabs.append(b); return b;
  });
  const strip = workspaceTabStrip(tabs, { appearance: 'header' });
  const add = button(doc, { text: '会議を作成', variant: 'primary', onClick: onCreate });
  add.prepend(workspaceActionIcon(doc, 'plus'));
  const tools = button(doc, { attrs: { 'aria-label': '表示と絞り込み', title: '表示と絞り込み' } });
  tools.classList.add('bb-ws-filter-icon-trigger');
  tools.append(workspaceActionIcon(doc, 'sliders'));
  const panel = n(doc, 'div', 'mp-panel-content');
  const pop = workspaceFilterPopover(doc, { trigger: tools, content: panel, appearance: 'panel' });
  const topbar = workspaceTopbar(doc, { title: '議事録', wrap:true, tabs, query: keyword, tools: [add, pop.root] });
  toolbar.replaceWith(topbar);
  const meaning = n(doc, 'div', 'mp-meaning');
  const chips = n(doc, 'div', 'mp-chips'), summary = n(doc, 'div', 'mp-summary');
  meaning.append(chips, summary); listPane.before(meaning);
  const rows = n(doc, 'div', 'mp-rows');
  const motion = workspaceRowMotion(rows);
  const allProjects = entries => [...new Set(entries.filter(e => joined(e)).flatMap(e => codes(e.meeting)))];
  const codes = m => Array.isArray(m?.project_codes) ? m.project_codes : [];
  const identities = () => (typeof principalIds === 'function' ? principalIds() : []).filter(Boolean);
  const joined = e => (e.meeting.participant_ids ?? []).some(id => identities().includes(id));
  const isMine = (e, entries) => codes(e.meeting).some(code => allProjects(entries).includes(code));
  const hosts = () => hostFilters().filter(f => f.id);
  function matchesPreset(entry, id, entries) {
    return id === 'joined' ? joined(entry) : id === 'waiting' ? listState(entry)?.code === 'pending' : id === 'recommend' ? isMine(entry, entries) : true;
  }
  function chooseView(value) {
    view = value; mine = value === 'recommend'; noDate = false; period = '';
    state.filters = { query: state.filters.query, from: '', to: '', participant: '', status: value === 'waiting' ? 'pending' : '' };
    sort = value === 'recommend' ? 'pending-first' : 'scheduled-desc'; onRender();
  }
  const reset = () => chooseView(view);
  const box = (label, options, value, onChange, extra = {}) => {
    const ctl = workspaceCombobox(doc, { label, options, value, onChange, appearance: 'compact', showCount: false, showHints: false, searchable: false, align: 'end', ...extra });
    boxes.push(ctl); return ctl;
  };
  const sortBox = box('並び順', SORTS, sort, value => { sort = value; onRender(); }, { className: 'is-boxed' });
  const whoBox = box('参加した人', [{value:'',label:'すべて'}], '', value => { state.filters.participant = value; onRender(); });
  const statusBox = box('確認の状態', [{value:'',label:'すべて'}, {value:'pending',label:'確認待ち'}, {value:'confirmed',label:'確認済み'}], '', value => { state.filters.status = value; onRender(); });
  const sortRow = workspaceControlRow(doc, { label: '並び順', control: sortBox.root });
  const hostSlot = n(doc, 'div', 'mp-project-controls');
  const whoRow = workspaceControlRow(doc, { label: '参加した人', control: whoBox.root, tight: true });
  const stateRow = workspaceControlRow(doc, { label: '確認の状態', control: statusBox.root, tight: true });
  const dateTrigger = button(doc, { text: 'すべて', attrs: { 'aria-label': '期間', 'aria-haspopup': 'dialog' } });
  dateTrigger.classList.add('mp-period-trigger');
  const calendar = n(doc, 'div', 'mp-period');
  const datePop = workspaceFilterPopover(doc, { trigger: dateTrigger, content: calendar });
  datePop.panel.classList.add('mp-calendar-popover');
  const periodRow = workspaceControlRow(doc, { label: '期間', control: datePop.root, tight: true });
  const foot = n(doc, 'div', 'mp-panel-foot'); foot.append(button(doc, { text: 'おすすめに戻す', onClick: () => chooseView('recommend') }));
  panel.append(sortRow, n(doc, 'div', 'mp-panel-group', '絞り込み'), hostSlot, whoRow, periodRow, stateRow, foot);
  function setPeriod(value) {
    period = value; noDate = value === 'none'; state.filters.from = ''; state.filters.to = '';
    const today = minutesDay(clock()), [y,m,d] = today.split('-').map(Number);
    const day = date => minutesDay(date);
    if (value === 'week') {
      const start = new Date(`${today}T12:00:00+09:00`); const offset=(start.getUTCDay()+6)%7; start.setUTCDate(start.getUTCDate()-offset);
      state.filters.from=day(start); start.setUTCDate(start.getUTCDate()+6); state.filters.to=day(start);
    } else if (value === 'month' || value === 'last') {
      const target = value === 'last' ? m-2 : m-1;
      state.filters.from = day(new Date(Date.UTC(y,target,1,3)));
      state.filters.to = day(new Date(Date.UTC(y,target+1,0,3)));
    }
    rangeStart=''; datePop.setOpen(false); onRender();
  }
  function renderCalendar() {
    calendar.replaceChildren();
    for (const [value,label] of [['','すべて'],['week','今週'],['month','今月'],['last','先月'],['none','日時なし']]) {
      calendar.append(button(doc, { text: label, attrs: { 'aria-pressed': String(period===value) }, onClick: () => setPeriod(value) }));
    }
    const [y,m] = month.split('-').map(Number);
    const head=n(doc,'div','mp-calendar-head',`${y}年${m}月`);
    for(const [delta,label,mark] of [[-1,'前の月','‹'],[1,'次の月','›']]) head.append(button(doc,{text:mark,attrs:{'aria-label':label},onClick:()=>{month=minutesDay(new Date(Date.UTC(y,m-1+delta,1,3))).slice(0,7);renderCalendar();}}));
    const grid=n(doc,'div','mp-calendar-grid','',{'aria-label':'期間のカレンダー'});
    WD.forEach(w=>grid.append(n(doc,'span','',w)));
    const first=new Date(Date.UTC(y,m-1,1)).getUTCDay(), days=new Date(Date.UTC(y,m,0)).getUTCDate();
    for(let i=0;i<first;i++)grid.append(n(doc,'span',''));
    for(let d=1;d<=days;d++){
      const value=`${month}-${String(d).padStart(2,'0')}`;
      const b=button(doc,{text:String(d),attrs:{'aria-label':`${y}年${m}月${d}日`,'aria-pressed':String(value===rangeStart||value===state.filters.from||value===state.filters.to)},onClick:()=>{
        if(!rangeStart){rangeStart=value;renderCalendar();return;}
        const [from,to]=[rangeStart,value].sort();state.filters.from=from;state.filters.to=to;noDate=false;period='custom';rangeStart='';datePop.setOpen(false);onRender();
      }});
      if(value===minutesDay(clock()))b.classList.add('is-today');
      if(value>state.filters.from&&value<state.filters.to)b.classList.add('is-in');
      grid.append(b);
    }
    calendar.append(head,grid,n(doc,'p','mp-calendar-hint',rangeStart?`${rangeStart} から。終わりの日を押してください`:'始まりの日を押してください'));
  }
  function project(meeting) {
    const root=n(doc,'span','mp-project');
    const context=projectContext?.(meeting);
    if(context?.icon)root.append(context.icon);
    root.append(n(doc,'span','',context?.label||'所属未確認'));
    return {root,stripe:context?.stripe||'var(--bb-color-border)'};
  }
  function row(entry, { preview=false }={}) {
    const m=entry.meeting, p=project(m), day=minutesDay(m.scheduled_at);
    const time=day?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(m.scheduled_at)):'';
    const title=n(doc,'strong','mp-title',m.title||'無題の会議');
    const people=n(doc,'span','mp-people','',{'aria-label':(m.participant_ids??[]).join('、')||'参加者の記録なし'});
    for(const id of (m.participant_ids??[]).slice(0,3))people.append(n(doc,'span','mp-avatar',[...id].slice(-1).join(''),{title:id}));
    people.append(n(doc,'small','',(m.participant_ids??[]).length?`${m.participant_ids.length}人`:'参加者の記録なし'));
    const count=entry.minutes?.length??0, version=versionNumber(entry);
    const note=[version>=2?`第${version}版`:'',count>=2?`議事録 ${count}件`:''].filter(Boolean).join('　');
    const cells=[minutesDateCell(doc,m,clock()),n(doc,'span','mp-time',time),title,minutesConfirmation(doc,listState(entry)),p.root,people,n(doc,'span','mp-note',note)];
    const root=workspaceCardRow(doc,{cells,stripe:p.stripe,selected:state.meetingId===m.meeting_id,key:m.meeting_id,label:m.title,preview,onSelect:preview?undefined:()=>onOpen(m.meeting_id)});
    root.classList.add('mp-row');root.setAttribute('aria-expanded',String(state.meetingId===m.meeting_id));return root;
  }
  function render(entries) {
    const hasStates=entries.some(listState);
    for(let i=0;i<VIEWS.length;i++){
      const [value]=VIEWS[i],b=tabButtons[i]; b.setAttribute('aria-selected',String(view===value));b.querySelector('b').textContent=String(entries.filter(e=>matchesPreset(e,value,entries)).length);
      b.disabled=value==='waiting'&&!hasStates;
    }
    strip.update();add.hidden=!canCreate();
    sortBox.update({value:sort});whoBox.update({value:state.filters.participant,options:[{value:'',label:'すべて'},...[...new Set(entries.flatMap(e=>e.meeting.participant_ids??[]))].sort().map(value=>({value,label:identities().includes(value)?'自分':value}))]});
    stateRow.hidden=!hasStates;statusBox.update({value:state.filters.status});
    for(const filter of hosts()){
      let item=projectBoxes.get(filter.id);
      if(!item){
        const ctl=box(filter.label,filter.options,filter.value,value=>{filter.onChange?.(value);onRender();},{multiple:filter.multiple,values:filter.values,renderIcon:filter.renderIcon});
        const root=workspaceControlRow(doc,{label:filter.label,control:ctl.root,tight:true});item={ctl,root};projectBoxes.set(filter.id,item);hostSlot.append(root);
      }
      item.ctl.update({value:filter.value,values:filter.values,options:filter.options,disabled:filter.disabled});
    }
    const chipItems=[];
    if(mine)chipItems.push({label:'自分が関わっているプロジェクト',onRemove:()=>{mine=false;onRender();}});
    if(view==='joined'&&!state.filters.participant)chipItems.push({label:'自分が出た会議',onRemove:()=>chooseView('all')});
    for(const f of hosts())for(const value of f.multiple?f.values??[]:f.value?[f.value]:[])chipItems.push({label:f.options?.find(o=>o.value===value)?.label??value,onRemove:()=>{f.onChange?.(f.multiple?(f.values??[]).filter(v=>v!==value):'');onRender();}});
    if(state.filters.participant)chipItems.push({label:`${state.filters.participant}が出た会議`,onRemove:()=>{state.filters.participant='';onRender();}});
    if(state.filters.status)chipItems.push({label:state.filters.status==='pending'?'確認待ち':'確認済み',onRemove:()=>{state.filters.status='';onRender();}});
    const periodText=period==='custom'?`${state.filters.from.replaceAll('-','/')}〜${state.filters.to.replaceAll('-','/')}`:({'week':'今週','month':'今月','last':'先月','none':'日時なし'}[period]||'すべて');
    dateTrigger.textContent=periodText;dateTrigger.classList.toggle('is-active',!!period);renderCalendar();
    if(period)chipItems.push({label:periodText,onRemove:()=>setPeriod('')});
    if(sort!=='scheduled-desc')chipItems.push({label:SORTS.find(o=>o.value===sort)?.label??'',onRemove:()=>{sort='scheduled-desc';onRender();}});
    const changed=mine!==(view==='recommend')||period||state.filters.from||state.filters.to||state.filters.participant||state.filters.status!==(view==='waiting'?'pending':'')||sort!==(view==='recommend'?'pending-first':'scheduled-desc');
    chips.replaceChildren(workspaceConditionChips(doc,{items:chipItems,reset:changed?reset:undefined,resetLabel:`「${VIEWS.find(v=>v[0]===view)[1]}」の初めに戻す`}));
    summary.replaceChildren();const undated=entries.filter(e=>!minutesDay(e.meeting.scheduled_at)).length;
    if(undated&&!noDate)summary.append(button(doc,{text:`日時なし ${undated}`,attrs:{'aria-label':'日時が分からない会議だけを見る'},onClick:()=>{view='all';mine=false;state.filters={query:state.filters.query,from:'',to:'',participant:'',status:''};setPeriod('none');}}));
    const today=minutesDay(clock()),start=new Date(`${today}T12:00:00+09:00`);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
    const week=minutesDay(start), previousDate=new Date(start);previousDate.setUTCDate(previousDate.getUTCDate()-7);const previous=minutesDay(previousDate);
    const dates=entries.map(e=>minutesDay(e.meeting.scheduled_at)).filter(Boolean);
    const count=from=>dates.filter(day=>day>=from&&day<=today).length;
    summary.append(n(doc,'span','',`今週 ${count(week)}　先週 ${dates.filter(day=>day>=previous&&day<week).length}　それより前 ${dates.filter(day=>day<previous).length}`));
    const visible=entries.filter(e=>(!(state.filters.from||state.filters.to)||!!minutesDay(e.meeting.scheduled_at))&&matchesFilters(e,{...state.filters,status:''})&&(!state.filters.status||listState(e)?.code===state.filters.status)&&hosts().every(f=>typeof f.matches!=='function'||f.matches(e,f.multiple?f.values??[]:f.value))&&(!mine||isMine(e,entries))&&(view!=='joined'||state.filters.participant||joined(e))&&(!noDate||!minutesDay(e.meeting.scheduled_at)));
    let ordered=sortMeetings(visible,sort==='pending-first'?'scheduled-desc':sort);
    if(sort==='pending-first')ordered=ordered.sort((a,b)=>Number(listState(b)?.code==='pending')-Number(listState(a)?.code==='pending'));
    rows.replaceChildren(...ordered.map(e=>row(e)));
    const head=n(doc,'div','mp-table-head');for(const label of ['日付','時刻','会議','確認','プロジェクト','参加した人','版'])head.append(n(doc,'span','',label));
    listPane.append(head,rows);motion.play();
    if(!canCreate())appendCreateUnavailable(listPane);
    const countNote=n(doc,'p','mp-count',`${ordered.length}件${state.nextCursor?'（続きあり・絞り込みは読込済みの会議が対象）':''}`);listPane.append(countNote);
    if(!ordered.length&&!state.listError)listPane.append(n(doc,'p','bb-minutes-empty',state.loading?'会議一覧を読み込んでいます。':'条件に合う会議はありません。'));
    return ordered;
  }
  return { render, row, project, highlightCreated(id) {
    const item = [...rows.children].find(row=>row.getAttribute('data-key')===id);
    if (!item) return;
    item.scrollIntoView?.({block:'nearest'});
    if (!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches && item.animate) {
      const style = doc.defaultView.getComputedStyle(item);
      item.animate([{background:style.getPropertyValue('--bb-color-accent-soft')},{background:style.getPropertyValue('--bb-color-paper')}],{duration:1600,easing:'ease-out'});
    }
  }, capture:()=>motion.capture(), destroy(){strip.destroy();pop.destroy();datePop.destroy();boxes.forEach(b=>b.destroy());motion.destroy();} };
}
