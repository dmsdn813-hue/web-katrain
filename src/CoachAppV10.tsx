import {useEffect,useMemo,useRef,useState} from 'react';
import {useGameStore} from './store/gameStore';
import {restoreCoachGame,startCoachAutosave} from './coachAutosave';
import {getLiberties,isValidMove,applyCapturesInPlace} from './utils/gameLogic';
import {generateSgfFromTree,parseSgf} from './utils/sgf';
import ProTsumego from './ProTsumego';
import type {BoardState,GameNode,Move,Player} from './types';

type Tab='play'|'learn'|'review';
type P={x:number;y:number};
type Saved={id:string;date:string;result:string;moves:number;sgf:string};
const COLS='ABCDEFGHJKLMNOPQRST';
const label=(p:P|null,n:number):string=>p&&p.x>=0&&p.y>=0?(COLS[p.x]??'?')+(n-p.y):'패스';
const legal=(p:P|null|undefined):p is P=>!!p&&p.x>=0&&p.y>=0;
function nodePath(node:GameNode):GameNode[]{const a:GameNode[]=[];for(let n:GameNode|null=node;n;n=n.parent)a.unshift(n);return a;}
function weakGroups(b:BoardState,color:Player){
 const n=b.length,seen=new Set<string>(),groups:{stones:P[];libs:P[]}[]=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  if(b[y]?.[x]!==color||seen.has(x+','+y))continue;
  const g=getLiberties(b,x,y),lib=new Map<string,P>();
  for(const t of g.group){seen.add(t.x+','+t.y);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const xx=t.x+dx,yy=t.y+dy;
   if(xx>=0&&yy>=0&&xx<n&&yy<n&&!b[yy]?.[xx])lib.set(xx+','+yy,{x:xx,y:yy});
  }}
  groups.push({stones:g.group,libs:[...lib.values()]});
 }
 return groups;
}
function simulate(before:BoardState,m:Move):BoardState{
 const b=before.map(row=>row.slice());
 if(m.x>=0&&m.y>=0&&b[m.y]?.[m.x]===null){
  b[m.y]![m.x]=m.player;applyCapturesInPlace(b,m.x,m.y,m.player);
 }
 return b;
}
function explain(before:BoardState,m:Move,after:BoardState){
 if(!legal(m))return {title:'패스한 수',detail:'이번 차례를 넘겼어. 아직 급하게 지키거나 잡을 돌이 남았는지 확인해 봐.',question:'상대가 어디에 두면 불편할까?'};
 const enemy=m.player==='black'?'white':'black';
 const captured=Math.max(0,before.flat().filter(s=>s===enemy).length-after.flat().filter(s=>s===enemy).length);
 if(after[m.y]?.[m.x]!==m.player)return {title:'돌이 잡힌 상황',detail:'이번 수가 놓인 뒤 판에서 돌이 사라졌어. 활로가 0이면 돌이 잡힌다는 규칙을 확인해 봐.',question:'어느 돌이 마지막 활로를 잃었을까?'};
 const g=getLiberties(after,m.x,m.y),n=after.length,neighbors=weakGroups(before,m.player).filter(t=>t.stones.some(s=>Math.abs(s.x-m.x)+Math.abs(s.y-m.y)===1));
 const attacked=weakGroups(after,enemy).filter(t=>t.libs.length===1&&t.stones.some(s=>Math.abs(s.x-m.x)+Math.abs(s.y-m.y)===1));
 if(captured)return {title:'상대 돌 '+captured+'개 포획',detail:'이곳을 차지하면서 상대 돌무리의 마지막 활로가 사라졌어. 방금 잡힌 돌이 어디에 있었는지 되짚어 보자.',question:'상대 돌은 어디로 도망갈 수 있었을까?'};
 if(g.liberties===1)return {title:'주의! 내 돌이 단수',detail:'이 수 이후 연결된 내 돌무리의 활로가 1개야. 다음에 상대가 그곳을 막으면 돌이 잡힐 수 있어.',question:'단 하나 남은 빈 점은 어디일까?'};
 if(attacked.length)return {title:'상대 돌을 단수로 공격',detail:'방금 수 옆의 상대 돌무리 활로가 1개야. 다만 상대가 도망가거나 되잡을 수 있어, 곧바로 포획이 확정된 건 아니야.',question:'백은 어디로 피하거나 반격할 수 있을까?'};
 if(neighbors.length>=2)return {title:'떨어진 돌들을 연결',detail:'전에는 분리된 내 돌무리들이 이곳에서 만나 연결돼. 이제 활로를 함께 써. 주변 상대의 끊는 수는 계속 살펴봐.',question:'상대가 이곳을 먼저 차지하면 어떤 돌이 분리될까?'};
 if(neighbors.length)return {title:'기존 돌에서 뻗는 수',detail:'이 수를 포함한 내 돌무리의 활로는 '+g.liberties+'개야. 상대가 접근하면 어느 방향으로 확장할지 생각해 봐.',question:'어느 쪽에서 공격받으면 힘들까?'};
 const edge=Math.min(m.x,m.y,n-1-m.x,n-1-m.y);
 return {title:edge<=2?'귀·변에서 자리 잡기':'중앙에 두기',detail:edge<=2?'귀·변은 비교적 적은 돌로 집을 만들기 쉬워. 다만 지금 당장 내 집이 되는 건 아니야.':'중앙에 둔 돌은 여러 방향으로 영향을 줄 수 있지만, 그것만으로 안전한 돌이나 집이 되는 건 아니야.',question:'지금 긴급하게 지키거나 공격할 다른 돌은 없을까?'};
}
function boardComponent():never{throw Error('not used');}
function GoBoard({board,onMove,last,mark,zoom}:{board:BoardState;onMove?:(x:number,y:number)=>void;last?:P|null;mark?:P|null;zoom?:boolean}){
 const n=board.length,o=23,w=328,step=w/(n-1),r=Math.min(18,step*.45);
 return <div className={'c10-boardwrap'+(zoom?' c10-zoom':'')}><svg className="c10-board" viewBox="0 0 374 383" role="group" aria-label={n+'줄 바둑판. 빈 교차점을 터치해 흑돌을 놓아.'}>
  <rect width="374" height="383" rx="13" fill="#e8c68e"/>
  {Array.from({length:n},(_,i)=><g key={i} stroke="#896c42" strokeWidth={n===19?0.9:1.2}>
   <line x1={o} x2={o+w} y1={o+i*step} y2={o+i*step}/>
   <line x1={o+i*step} x2={o+i*step} y1={o} y2={o+w}/>
  </g>)}
  {Array.from({length:n},(_,i)=><g key={'axis'+i} textAnchor="middle" fontSize={n===19?9:11} fill="#755637" fontWeight="750">
   <text x={o+i*step} y="372">{COLS[i]}</text><text x="9" y={o+i*step+4}>{n-i}</text>
  </g>)}
  {board.map((row,y)=>row.map((stone,x)=>{
   const cx=o+x*step,cy=o+y*step,chosen=last?.x===x&&last.y===y,goal=mark?.x===x&&mark.y===y;
   return <g key={x+':'+y}>
    {stone&&<circle cx={cx} cy={cy} r={r} fill={stone==='black'?'#1b2820':'#fbfbfa'} stroke={stone==='black'?'#111d16':'#9ea49b'} strokeWidth="1.1"/>}
    {chosen&&<circle cx={cx} cy={cy} r={Math.max(2,r*.24)} fill={stone==='black'?'#fff':'#333'}/>}
    {goal&&<circle cx={cx} cy={cy} r={r+3} fill="none" stroke="#2a915c" strokeWidth="3.4"/>}
    {!stone&&onMove&&<circle cx={cx} cy={cy} r={Math.max(9,step*.48)} fill="transparent" role="button" tabIndex={0} aria-label={label({x,y},n)+' 착수'} onClick={()=>onMove(x,y)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onMove(x,y);}}}/>}
   </g>;
  }))}
 </svg></div>;
}
function readPrefs():{tab:Tab;level:18|12|7}{
 try{const p=JSON.parse(localStorage.getItem('baduk-coach:ui-prefs:v1')||'{}') as {tab?:unknown;level?:unknown};
 return {tab:p.tab==='learn'?'learn':'play',level:p.level===18||p.level===7?p.level:12};
 }catch{return {tab:'play',level:12};}
}
function readArchive():Saved[]{
 try{const raw=JSON.parse(localStorage.getItem('my-go-coach:completed-games')||'[]') as unknown;
 return Array.isArray(raw)?raw.filter((v):v is Saved=>!!v&&typeof v==='object'&&typeof v.sgf==='string'&&typeof v.id==='string').slice(0,12):[];
 }catch{return [];}
}
function oldReview(sgf:string){
 const data=parseSgf(sgf),b=data.initialBoard.map(row=>row.slice());
 let now=b;const items:{board:BoardState;move:Move|null}[]=[{board:b,move:null}];
 for(const m of data.moves){now=simulate(now,m);items.push({board:now,move:m});}
 return items;
}
function approximateScore(board:BoardState,komi:number){
 const n=board.length,done=new Set<string>();let black=0,white=komi;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const v=board[y]?.[x];if(v==='black'){black++;continue;}if(v==='white'){white++;continue;}
  if(done.has(x+','+y))continue;
  const q:[number,number][]=[[x,y]],border=new Set<Player>();done.add(x+','+y);
  for(let i=0;i<q.length;i++){
   const [cx,cy]=q[i]!;
   for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const xx=cx+dx,yy=cy+dy;if(xx<0||yy<0||xx>=n||yy>=n)continue;
    const k=xx+','+yy,t=board[yy]?.[xx];if(t)border.add(t);
    else if(!done.has(k)){done.add(k);q.push([xx,yy]);}
   }
  }
  if(border.size===1){if(border.has('black'))black+=q.length;else white+=q.length;}
 }
 return {winner:black>=white?'흑':'백',margin:Math.abs(black-white)};
}
const CSS=[
'.c10-app{min-height:100dvh;background:#f8faf5;color:#2b4032;padding:13px 13px 26px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,Apple SD Gothic Neo,Noto Sans KR,sans-serif}',
'.c10-app *{box-sizing:border-box}.c10-container{max-width:470px;margin:auto}.c10-header{display:flex;justify-content:space-between;align-items:center;margin:1px 2px 11px}.c10-logo{font-weight:950;font-size:21px;letter-spacing:-.045em;color:#2d5c40}.c10-save{font-size:10px;color:#7d9d82;font-weight:800}.c10-save.bad{color:#b45a44}',
'.c10-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:#e5eee4;padding:4px;border-radius:13px;margin:0 0 12px}.c10-tabs button{background:transparent;border:0;border-radius:10px;min-height:40px;color:#6d8772;font-size:13px;font-weight:850}.c10-tabs button.on{background:white;color:#26563a;box-shadow:0 1px 5px #2538261c}',
'.c10-msg{background:#edf6ea;color:#417452;font-size:12px;line-height:1.5;padding:9px 11px;border-radius:9px;margin:0 0 8px}.c10-state{display:flex;justify-content:space-between;gap:8px;margin:0 1px 7px;font-size:12px;color:#748d7a;font-weight:750}.c10-state strong{color:#2d6042;font-size:13px}',
'.c10-boardwrap{width:100%;max-width:370px;overflow:hidden;border-radius:13px;margin:auto;background:#e8c68e;box-shadow:0 3px 15px #59431a13}.c10-board{width:100%;display:block;height:auto;touch-action:manipulation;user-select:none}.c10-zoom{overflow-x:auto;max-width:100%}.c10-zoom .c10-board{min-width:500px}.c10-board [role=button]{cursor:pointer}',
'.c10-actions{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:6px;margin:10px 0}.c10-btn{background:white;color:#39694a;border:1px solid #d2e2d3;border-radius:10px;min-height:43px;padding:9px 7px;font-size:12px;font-weight:900}.c10-btn.primary{background:#306b49;color:#fff;border-color:#306b49}.c10-btn:disabled{opacity:.42}.c10-quick{border:1px solid #dce9dc;background:white;border-radius:13px;padding:12px 13px;margin:8px 0}.c10-quick strong{font-size:13px;color:#315e44}.c10-quick p{font-size:12px;line-height:1.6;margin:6px 0 10px;color:#59725f}.c10-quickbuttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}.c10-quickbuttons button{border:1px solid #cfe2d0;background:#f5faf5;color:#35684a;min-height:39px;border-radius:9px;font-size:12px;font-weight:850}.c10-quickbuttons button:disabled{opacity:.45}',
'.c10-more{border:1px solid #e0e9de;background:white;padding:0 13px;margin:10px 0;border-radius:11px}.c10-more summary{cursor:pointer;padding:12px 1px;font-size:12px;color:#66826b;font-weight:850}.c10-more .c10-morebody{padding:3px 0 13px}.c10-more label{display:block;color:#47684f;font-size:12px;margin:9px 0}.c10-more select{width:100%;background:#fbfdf8;border:1px solid #d7e5d8;border-radius:9px;padding:10px;font-size:13px}.c10-small{font-size:11px;line-height:1.6;color:#8b9f8c}',
'.c10-note{border-radius:13px;border:1px solid #dce7dc;background:white;padding:13px;margin:0 0 12px}.c10-note h2{font-size:15px;color:#2d5e40;margin:0 0 7px}.c10-note p{font-size:12px;line-height:1.75;color:#617c67;margin:7px 0}.c10-reviewbuttons{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}.c10-reviewbuttons button{border:1px solid #d3e3d5;border-radius:8px;background:white;min-height:38px;color:#3d6e4d;font-size:12px;font-weight:800}.c10-reviewbuttons button:disabled{opacity:.45}.c10-slider{width:100%;margin:10px 0;accent-color:#2c754d}.c10-archive{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #edf1ec;padding:10px 0;gap:7px;font-size:12px}',
'.c10-backdrop{position:fixed;inset:0;background:#23392a75;z-index:60;display:flex;align-items:flex-end;justify-content:center}.c10-sheet{width:min(100%,510px);max-height:67dvh;overflow-y:auto;overscroll-behavior:contain;border-radius:21px 21px 0 0;background:white;padding:16px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -6px 30px #121d152a}.c10-sheetheader{display:flex;align-items:center;justify-content:space-between;gap:8px}.c10-sheetheader h2{font-size:16px;margin:0;color:#2d5b3f}.c10-sheetheader button{border:0;background:#edf5ec;color:#376c49;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:900}.c10-sheet p{font-size:13px;color:#56715b;line-height:1.75}.c10-sheet section{background:#f0f7ee;border-radius:11px;padding:12px;margin:12px 0;font-size:13px;color:#3e664a;line-height:1.7}',
'@media(min-width:720px){.c10-app{padding-top:24px}}'
].join('');
export default function CoachAppV10(){
 const board=useGameStore(s=>s.board),node=useGameStore(s=>s.currentNode),player=useGameStore(s=>s.currentPlayer);
 const history=useGameStore(s=>s.moveHistory),aiBusy=useGameStore(s=>s.isAiThinking),modelStatus=useGameStore(s=>s.engineStatus);
 const modelError=useGameStore(s=>s.engineError),settings=useGameStore(s=>s.settings),treeVersion=useGameStore(s=>s.treeVersion),analysisEnabled=useGameStore(s=>s.isAnalysisMode);
 const [prefs]=useState(readPrefs),[tab,setTab]=useState<Tab>(prefs.tab),[level,setLevel]=useState<18|12|7>(prefs.level);
 const [sheet,setSheet]=useState<'hint'|'lesson'|'best'|null>(null),[hint,setHint]=useState(0),[showBest,setShowBest]=useState(false);
 const [zoom,setZoom]=useState(false),[status,setStatus]=useState<'pending'|'saved'|'error'>('pending');
 const [message,setMessage]=useState(''),[notice,setNotice]=useState(''),[archive,setArchive]=useState(readArchive),[archiveId,setArchiveId]=useState<string|null>(null),[reviewAt,setReviewAt]=useState(0);
 const initialized=useRef(false),blocked=useRef(false),reported=useRef(new Set<string>()),pendingAnalysis=useRef(new Set<string>());
 const n=board.length,num=history.length;
 const finished=Boolean(node.endState)||(num>=2&&history[num-1]?.x<0&&history[num-2]?.x<0);
 const line=useMemo(()=>nodePath(node),[node,treeVersion]);
 const lastBlack=useMemo(()=>[...line].reverse().find(p=>p.move?.player==='black')??null,[line]);
 const lastFacts=useMemo(()=>lastBlack?.move&&lastBlack.parent?explain(lastBlack.parent.gameState.board,lastBlack.move,lastBlack.gameState.board):null,[lastBlack]);
 const weak=useMemo(()=>weakGroups(board,'black').filter(g=>g.libs.length===1),[board]);
 const choices=useMemo(()=>player==='black'?(node.analysis?.moves??[]).filter(m=>m.x>=0&&m.y>=0&&isValidMove(board,m.x,m.y,'black',node.parent?.gameState.board)).sort((a,b)=>a.order-b.order).slice(0,2):[],[node,board,player,treeVersion]);
 const best=choices[0];
 const frames=useMemo(()=>{
  if(archiveId){const saved=archive.find(g=>g.id===archiveId);if(saved){try{return oldReview(saved.sgf);}catch{/* malformed archive */}}}
  return line.map(p=>({board:p.gameState.board,move:p.move}));
 },[line,archiveId,archive]);
 const active=frames[Math.min(reviewAt,frames.length-1)]??frames[0];
 const prev=frames[Math.min(reviewAt,frames.length-1)-1];
 const reviewFacts=active?.move&&prev?explain(prev.board,active.move,active.board):null;
 useEffect(()=>{
  if(!initialized.current){
   initialized.current=true;document.title='바둑 한 수 · 편한 바둑 과외';document.documentElement.lang='ko';
   const s=useGameStore.getState();
   if(s.isAiPlaying&&s.aiColor)s.toggleAi(s.aiColor);
   s.updateSettings({appLocale:'ko',aiStrategy:'rank',aiRankKyu:level,analysisExperience:'coach',katagoVisits:160,katagoMaxTimeMs:6500});
   if(!s.isAnalysisMode)s.toggleAnalysisMode();
   const saved=restoreCoachGame();
   if(saved.status!=='empty')setMessage(saved.message);
   if(saved.status==='blocked')blocked.current=true;
   setZoom(useGameStore.getState().board.length===19);
  }
  if(blocked.current){setStatus('error');return;}
  return startCoachAutosave(ok=>setStatus(ok?'saved':'error'));
 },[]);
 useEffect(()=>{try{localStorage.setItem('baduk-coach:ui-prefs:v1',JSON.stringify({tab,level}));}catch{/* private browsing */}},[tab,level]);
 useEffect(()=>{
  if(tab!=='play'||player!=='black'||finished||!analysisEnabled||node.analysis?.moves?.length)return;
  const key=node.id+settings.katagoModelUrl;if(pendingAnalysis.current.has(key))return;
  pendingAnalysis.current.add(key);
  void useGameStore.getState().runAnalysis({ifIdle:true,visits:n===19?45:140,maxTimeMs:6500,topK:12}).catch(()=>pendingAnalysis.current.delete(key));
 },[tab,node,player,finished,analysisEnabled,settings.katagoModelUrl,n,treeVersion]);
 useEffect(()=>{
  if(!finished||!num)return;
  const key=node.id+':'+num;
  if(reported.current.has(key))return;
  reported.current.add(key);
  try{
   const sgf=generateSgfFromTree(useGameStore.getState().rootNode,{trainer:{saveAnalysis:false}});
   const old=readArchive();if(old.some(g=>g.sgf===sgf))return;
   const result=node.endState?node.endState:((v)=>'잠정 '+v.winner+' '+v.margin.toFixed(1)+'집 차')(approximateScore(board,6.5));
   const item:Saved={id:Date.now().toString(36),date:new Date().toLocaleDateString('ko-KR'),moves:num,result,sgf};
   const updated=[item,...old].slice(0,12);localStorage.setItem('my-go-coach:completed-games',JSON.stringify(updated));setArchive(updated);
  }catch{/* localStorage unavailable */}
 },[finished,node,num,board]);
 useEffect(()=>{if(tab==='review')setReviewAt(i=>Math.min(i,frames.length-1));},[tab,frames.length]);
 function goTab(next:Tab){setTab(next);setSheet(null);if(next==='review'){setArchiveId(null);setReviewAt(line.length-1);}}
 function play(x:number,y:number){
  const s=useGameStore.getState();if(tab!=='play'||s.currentPlayer!=='black'||s.isAiThinking||finished)return;
  if(!isValidMove(s.board,x,y,'black',s.currentNode.parent?.gameState.board)){setNotice('지금은 둘 수 없는 자리야.');return;}
  s.playMove(x,y);setSheet(null);setHint(0);setShowBest(false);setNotice('');
 }
 function aiReply(){
  if(player!=='white'||aiBusy||finished)return;
  setSheet(null);setNotice('');useGameStore.getState().makeAiMove({force:true});
 }
 function undo(){
  const s=useGameStore.getState();if(!s.currentNode.parent||s.isAiThinking)return;
  const twice=s.currentPlayer==='black'&&s.currentNode.move?.player==='white'&&s.currentNode.parent?.move?.player==='black';
  s.undoMove();if(twice)useGameStore.getState().undoMove();
  setSheet(null);setNotice('이전 수로 돌아갔어. 다시 생각해 보자.');
 }
 function newGame(){
  if(num&&!window.confirm('지금 대국을 끝내고 새 판을 시작할까? 복기 자료실에서 기보를 먼저 저장할 수 있어.'))return;
  useGameStore.getState().startNewGame({boardSize:n as 9|13|19,rules:'chinese',komi:6.5,handicap:0});
  setSheet(null);setNotice('새 판을 시작했어.');
 }
 function changeBoard(size:9|13|19){
  if(size===n)return;
  if(num&&!window.confirm('판 크기를 바꾸면 새 대국이 시작돼. 계속할까?'))return;
  useGameStore.getState().startNewGame({boardSize:size,rules:'chinese',komi:6.5,handicap:0});
  setSheet(null);setZoom(size===19);setNotice(size+'줄 새 판이야.');
 }
 function download(){
  try{
   const sgf=generateSgfFromTree(useGameStore.getState().rootNode);
   const url=URL.createObjectURL(new Blob([sgf],{type:'application/x-go-sgf;charset=utf-8'}));
   const a=document.createElement('a');a.href=url;a.download='바둑한수_대국기록.sgf';document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch{setNotice('SGF 파일을 만들지 못했어.');}
 }
 function openHint(){setHint(1);setSheet('hint');setShowBest(false);}
 const hintText=hint===1?(weak.length?'내 흑돌 중 활로가 1개인 무리가 '+weak.length+'개 있어. 먼저 내 돌이 바로 잡힐 수 있는지 확인해 봐.':'지금 내 돌이 단수인 곳은 없어. 그다음은 상대 돌을 잡거나 내 돌을 연결할 자리를 찾아봐.'):hint===2?(weak.length?'마지막 활로: '+weak.map(g=>g.libs.map(p=>label(p,n)).join(', ')).join(' · ')+'. 무조건 그곳이 최선인 건 아니지만 급한 자리가 될 수 있어.':'백돌 중 활로가 적은 무리가 있는지 살펴봐. 급한 곳이 없다면 귀·변에서 공간을 넓힐 수 있을까?'):best?'추천 후보는 '+label(best,n)+'야. 이 자리가 최선인지는 AI 모델과 탐색량에 따라 달라져.':'KataGo 분석 중이야. 아직 후보를 확인할 수 없어.';
 const focus=sheet==='hint'&&hint===3&&best?{x:best.x,y:best.y}:sheet==='best'&&showBest&&best?{x:best.x,y:best.y}:null;
 const activeReviewMove=active?.move&&legal(active.move)?active.move:null;
 return <main className="c10-app" lang="ko"><style>{CSS}</style><div className="c10-container">
  <header className="c10-header"><strong className="c10-logo">● 바둑 한 수</strong><span className={'c10-save'+(status==='error'?' bad':'')}>{status==='saved'?'✓ 자동 저장':status==='error'?'⚠️ 저장 실패':'저장 준비 중'}</span></header>
  <nav className="c10-tabs" aria-label="바둑앱 메뉴">{([['play','⚫ 대국'],['learn','📚 배우기'],['review','↶ 복기']] as const).map(([id,name])=><button key={id} type="button" className={tab===id?'on':''} aria-current={tab===id?'page':undefined} onClick={()=>goTab(id)}>{name}</button>)}</nav>
  {message&&<p className="c10-msg" role="status">{message}</p>}
  {notice&&<p className="c10-msg" role="status">{notice}</p>}
  {tab==='play'&&<>
   <div className="c10-state"><strong>{finished?'🏁 대국 종료':player==='white'?'⚪ 백 차례':'⚫ 흑 차례 · 직접 두기'}</strong><span>{n}×{n} · {num}수</span></div>
   <GoBoard board={board} last={node.move} mark={focus} zoom={zoom} onMove={player==='black'&&!finished&&!aiBusy?play:undefined}/>
   <div className="c10-actions"><button type="button" className="c10-btn primary" disabled={finished||player!=='white'||aiBusy} onClick={aiReply}>{aiBusy?'⚪ 생각 중…':'⚪ 백 응수'}</button><button type="button" className="c10-btn" disabled={finished||player!=='black'} onClick={()=>useGameStore.getState().passTurn()}>패스</button><button type="button" className="c10-btn" disabled={!node.parent||aiBusy} onClick={undo}>↶ 무르기</button></div>
   <section className="c10-quick"><strong>👩‍🏫 {finished?'이번 대국을 복기해 보자!':player==='white'?'백이 어디에 둘지 예상해 봐':lastFacts?.title??'이번 수는 어디가 좋을까?'}</strong><p>{finished?'복기 탭에서 아쉬웠던 수를 확인할 수 있어.':player==='white'?'응수 버튼을 눌러 백이 어떻게 대응하는지 확인해 봐.':num?'설명은 필요할 때만 열 수 있어. 추천 자리는 처음부터 보여 주지 않아.':'내 돌의 위험, 상대를 잡을 기회, 돌의 연결, 집을 넓힐 자리를 살펴보고 스스로 첫 수를 골라 봐.'}</p>
   <div className="c10-quickbuttons"><button type="button" onClick={openHint} disabled={player!=='black'||finished}>💡 힌트</button><button type="button" onClick={()=>{setSheet('lesson');setShowBest(false);}}>📖 꼼꼼한 해설</button></div></section>
   <details className="c10-more"><summary>⚙️ 더보기 · 새 판 / 판 크기 / 난이도</summary><div className="c10-morebody">
    <div className="c10-quickbuttons"><button type="button" onClick={newGame}>＋ 새 판</button><button type="button" onClick={()=>setZoom(v=>!v)}>{zoom?'⊟ 판 맞추기':'⊞ 판 확대'}</button></div>
    <label>바둑판 크기<select value={n} onChange={e=>changeBoard(Number(e.target.value) as 9|13|19)}><option value={9}>9×9</option><option value={13}>13×13</option><option value={19}>19×19</option></select></label>
    <label>백 AI 난이도<select value={level} onChange={e=>{const v=Number(e.target.value) as 18|12|7;setLevel(v);useGameStore.getState().updateSettings({aiStrategy:'rank',aiRankKyu:v});}}><option value={18}>입문</option><option value={12}>초급</option><option value={7}>도전</option></select></label>
    <div className="c10-quickbuttons"><button type="button" disabled={finished} onClick={()=>{if(window.confirm('이 대국을 기권할까?'))useGameStore.getState().resign('black');}}>기권</button><button type="button" onClick={download}>현재 기보 다운로드</button></div>
    <p className="c10-small">{modelStatus==='error'?'AI 오류: '+(modelError??'실행 상태 확인 필요'):'AI 분석은 브라우저에서 진행해.'} 같은 Safari에 대국과 학습 기록을 자동 저장해.</p>
   </div></details>
   {finished&&<section className="c10-note"><h2>🏁 대국이 끝났어</h2><p>{node.endState?'결과: '+node.endState:(v=>'잠정 집 계산: '+v.winner+' '+v.margin.toFixed(1)+'집 차')(approximateScore(board,6.5))} · 죽은 돌을 따로 정리하지 않은 잠정 계산일 수 있어.</p><button type="button" className="c10-btn primary" onClick={()=>goTab('review')}>복기하러 가기 →</button></section>}
  </>}
  {tab==='learn'&&<><div className="c10-note"><h2>📚 중급 수읽기 · 꼼꼼한 해설</h2><p>쉬운 삼지선다 대신 실제 중급 바둑 문제를 풀어 봐. 틀린 수와 정답 변화도를 비교하고, 상대가 어디에 두는지도 차례로 확인해.</p></div><ProTsumego/></>}
  {tab==='review'&&<>
   <div className="c10-state"><strong>↶ {archiveId?'저장된 대국':'진행 중인 대국'} 복기</strong><span>{reviewAt}/{Math.max(0,frames.length-1)}수</span></div>
   {active&&<GoBoard board={active.board} last={activeReviewMove}/>}
   <input type="range" className="c10-slider" min={0} max={Math.max(0,frames.length-1)} value={Math.min(reviewAt,frames.length-1)} aria-label="복기 수 이동" onChange={e=>setReviewAt(Number(e.target.value))}/>
   <div className="c10-reviewbuttons"><button type="button" disabled={reviewAt===0} onClick={()=>setReviewAt(0)}>처음</button><button type="button" disabled={reviewAt===0} onClick={()=>setReviewAt(x=>Math.max(0,x-1))}>◀ 이전</button><button type="button" disabled={reviewAt>=frames.length-1} onClick={()=>setReviewAt(x=>Math.min(frames.length-1,x+1))}>다음 ▶</button><button type="button" disabled={reviewAt>=frames.length-1} onClick={()=>setReviewAt(frames.length-1)}>마지막</button></div>
   <section className="c10-note"><h2>{active?.move?(active.move.player==='black'?'흑 ':'백 ')+label(active.move,active.board.length)+' · '+reviewAt+'수':'처음 바둑판'}</h2><p>{reviewFacts?reviewFacts.detail:'수순을 이동하면 그때 돌을 놓은 이유와 활로의 변화를 확인할 수 있어.'}</p>{reviewFacts&&<p>❓ {reviewFacts.question}</p>}</section>
   <section className="c10-note"><h2>🗂️ 대국 자료실</h2><div className="c10-quickbuttons"><button type="button" onClick={()=>{setArchiveId(null);setReviewAt(line.length-1);}}>현재 대국</button><button type="button" onClick={download}>기보 파일 저장</button></div>
    {archive.map(x=><div key={x.id} className="c10-archive"><span>{x.date} · {x.moves}수 · {x.result}</span><button type="button" className="c10-btn" onClick={()=>{setArchiveId(x.id);setReviewAt(0);}}>복기</button></div>)}</section>
  </>}
 </div>
 {sheet&&tab==='play'&&<div className="c10-backdrop" role="presentation" onClick={()=>setSheet(null)}><div className="c10-sheet" role="dialog" aria-modal="true" aria-label="바둑 선생님 해설" onClick={e=>e.stopPropagation()}>
  <div className="c10-sheetheader"><h2>{sheet==='hint'?'💡 스스로 생각하는 힌트':sheet==='best'?'🔍 추천수의 이유':'📖 선생님 해설'}</h2><button type="button" onClick={()=>setSheet(null)}>닫기 ✕</button></div>
  {sheet==='hint'&&<><section>{hintText}</section>{hint<3&&<button type="button" className="c10-btn primary" onClick={()=>setHint(v=>Math.min(v+1,3))}>다음 힌트 {hint+1}/3</button>}{hint===3&&<button type="button" className="c10-btn" onClick={()=>{setSheet('best');setShowBest(false);}}>이 자리의 이유 알아보기 →</button>}</>}
  {sheet==='lesson'&&<>{lastFacts&&lastBlack?.move?<><section><strong>흑 {label(lastBlack.move,n)} · {lastFacts.title}</strong><p>{lastFacts.detail}</p></section><p><strong>직접 생각할 질문</strong><br/>{lastFacts.question}</p><p>이 설명은 돌의 포획·활로·연결처럼 판에서 확인되는 결과만 다뤄. 어떤 수가 최선인지 알려면 백의 응수와 전체 판도 함께 봐야 해.</p></>:<p>아직 둔 흑돌이 없어. 돌을 놓기 전에 어느 곳이 급한지 먼저 찾아보자.</p>}{player==='black'&&<button type="button" className="c10-btn" onClick={()=>{setSheet('best');setShowBest(false);}}>추천수와 비교하기 →</button>}</>}
  {sheet==='best'&&<>{player==='white'?<p>백이 응수한 다음 다시 확인해 봐.</p>:best?<><p>현재 분석에서 우선 추천하는 곳은 <strong>{label(best,n)}</strong>이야. 정답을 그대로 따라 두기보다는 왜 필요한지 먼저 생각해 봐.</p><button type="button" className="c10-btn primary" onClick={()=>setShowBest(true)}>바둑판에 위치 표시 &amp; 효과 설명</button>{showBest&&<section>{(()=>{const r=explain(board,{x:best.x,y:best.y,player:'black'},simulate(board,{x:best.x,y:best.y,player:'black'}));return r.title+' · '+r.detail;})()}<p>단, 이 설명은 이 수의 즉각적인 효과일 뿐이고, KataGo가 추천한 모든 전략적 이유를 검증한 것은 아니야.</p></section>}</>:<p>AI 분석이 아직 완료되지 않았어. 먼저 내가 잡힐 돌이 없는지 확인해 봐.</p>}</>}
  <p className="c10-small">설명창은 화면 아래에서 열리고 닫을 때 바둑판으로 스크롤이 튀지 않아.</p>
 </div></div>}
 </main>;
}
