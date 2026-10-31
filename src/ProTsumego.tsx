import {useEffect,useMemo,useState} from 'react';
import {getLiberties} from './utils/gameLogic';
import {parseSgf,type ParsedSgfNode} from './utils/sgf';
import type {BoardState,Player} from './types';
import {HARD_GGG_PROBLEMS} from './gggHardProblems';
import SgfLessonWalkthrough from './SgfLessonWalkthrough';
import {INTERMEDIATE_GGG_PROBLEMS} from './gggIntermediateProblems';

type Puzzle={id:string;title:string;difficulty:string;sgf:string;source:string};
type Coord={x:number;y:number};
const ALL_PROBLEMS:Puzzle[]=[...HARD_GGG_PROBLEMS,...INTERMEDIATE_GGG_PROBLEMS];
type Replay={board:BoardState;node:ParsedSgfNode;moves:{who:Player;at:Coord|null}[];previous:BoardState|null};
const COLS='ABCDEFGHJKLMNOPQRST';
const pointName=(p:Coord|null,n=19)=>p?COLS[p.x]+String(n-p.y):'패스';
function sgfPoint(input:string):Coord|null{
  if(!input || input==='tt')return null;
  if(input.length!==2)return null;
  return {x:input.charCodeAt(0)-97,y:input.charCodeAt(1)-97};
}
function moveFromNode(node:ParsedSgfNode,color:Player):Coord|null|undefined{
  const arr=node.props[color==='black'?'B':'W'];
  if(!arr || arr.length===0)return undefined;
  return sgfPoint(arr[0]!);
}
function hasCorrect(node:ParsedSgfNode):boolean{
  const stack=[node];let visits=0;
  while(stack.length&&visits++<2000){
    const cur=stack.pop()!;
    if((cur.props.C??[]).some(c=>/\bCorrect\b/i.test(c)))return true;
    stack.push(...cur.children);
  }
  return false;
}
function exactlyCorrect(node:ParsedSgfNode):boolean{
  return (node.props.C??[]).some(c=>/\bCorrect\b/i.test(c));
}
function simulate(board:BoardState,who:Player,p:Coord|null,previous:BoardState|null):BoardState|null{
  if(p===null)return board.map(row=>row.slice());
  const n=board.length;
  if(p.x<0||p.y<0||p.x>=n||p.y>=n||board[p.y]?.[p.x])return null;
  const next=board.map(row=>row.slice());next[p.y]![p.x]=who;
  const other=who==='black'?'white':'black',seen=new Set<string>();
  for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
    const x=p.x+dx,y=p.y+dy;
    if(x<0||y<0||x>=n||y>=n||next[y]?.[x]!==other||seen.has(x+','+y))continue;
    const group=getLiberties(next,x,y);
    for(const stone of group.group)seen.add(stone.x+','+stone.y);
    if(group.liberties===0)for(const stone of group.group)next[stone.y]![stone.x]=null;
  }
  if(getLiberties(next,p.x,p.y).liberties===0)return null;
  if(previous && previous.every((row,y)=>row.every((stone,x)=>stone===next[y]?.[x])))return null;
  return next;
}
function firstPlayer(root:ParsedSgfNode):Player{
  const t=root.props.C?.join(' ')??'';
  if(/white to play/i.test(t))return 'white';
  if(/black to play/i.test(t))return 'black';
  return root.children.some(c=>c.props.W?.length)?'white':'black';
}
function opening(problem:Puzzle):{initial:Replay;human:Player;n:number}|null{
  const sgf=parseSgf(problem.sgf);
  if(!sgf.tree)return null;
  const size=sgf.initialBoard.length;
  return {initial:{board:sgf.initialBoard.map(r=>r.slice()),node:sgf.tree,moves:[],previous:null},human:firstPlayer(sgf.tree),n:size};
}
function crop(board:BoardState,tree:ParsedSgfNode):{startX:number;startY:number;size:number}{
  const n=board.length;let xs:number[]=[],ys:number[]=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(board[y]?.[x]){xs.push(x);ys.push(y);}
  let cur=tree;let k=0;
  // Main answer line only, to avoid distant ko threats in side variations.
  while(cur.children.length>0&&k++<18){
    const next=cur.children.find(c=>hasCorrect(c))??cur.children[0]!;
    for(const who of ['black','white'] as const){
      const p=moveFromNode(next,who);
      if(p){xs.push(p.x);ys.push(p.y);}
    }
    cur=next;
  }
  if(!xs.length)return {startX:0,startY:0,size:n};
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const span=Math.max(right-left+1,bottom-top+1);
  const size=Math.min(n,Math.max(9,span+2));
  const startX=Math.max(0,Math.min(n-size,Math.floor((left+right-size+1)/2)));
  const startY=Math.max(0,Math.min(n-size,Math.floor((top+bottom-size+1)/2)));
  return {startX,startY,size};
}
function PuzzleBoard({grid,cropped,choice,onPoint,editable}:{
 grid:BoardState;cropped:{startX:number;startY:number;size:number};choice:Coord|null;onPoint:(p:Coord)=>void;editable:boolean;
}){
 const {startX,startY,size}=cropped;
 const step=340/(size-1),rad=Math.min(20,step*.45),left=27,top=27;
 return <svg viewBox="0 0 396 405" className="pro-board" role="group" aria-label={size+'줄로 확대한 바둑 문제. 빈 교차점을 터치하세요.'}>
   <rect width="396" height="405" rx="15" fill="#e6c28e"/>
   {Array.from({length:size},(_,i)=><g key={'l'+i} stroke="#89693f" strokeWidth="1.15">
     <line x1={left} x2={left+340} y1={top+i*step} y2={top+i*step}/>
     <line x1={left+i*step} x2={left+i*step} y1={top} y2={top+340}/>
   </g>)}
   {Array.from({length:size},(_,i)=><g key={'a'+i} fill="#725432" fontSize="12" textAnchor="middle" fontWeight="700">
     <text x={left+i*step} y="391">{COLS[startX+i]}</text>
     <text x="12" y={top+i*step+4}>{grid.length-(startY+i)}</text>
   </g>)}
   {Array.from({length:size*size},(_,i)=>{
     const x=startX+i%size,y=startY+Math.floor(i/size),stone=grid[y]?.[x],xx=left+(x-startX)*step,yy=top+(y-startY)*step;
     const selected=choice?.x===x&&choice.y===y;
     return <g key={x+','+y}>
       {stone&&<circle cx={xx} cy={yy} r={rad} fill={stone==='black'?'#1c2621':'#fbfcfb'} stroke={stone==='black'?'#131a17':'#b6b6b2'} strokeWidth="1.3"/>}
       {selected&&<circle cx={xx} cy={yy} r={rad+3} fill="none" stroke="#27845c" strokeWidth="3.5"/>}
       {!stone&&editable&&<circle role="button" tabIndex={0} aria-label={pointName({x,y},grid.length)+'에 두기'} cx={xx} cy={yy} r={Math.max(11,step*.5)} fill="transparent" onClick={()=>onPoint({x,y})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPoint({x,y});}}}/>}
     </g>;
   })}
 </svg>;
}
function savedSolved():Record<string,boolean>{
 try{
   const o=JSON.parse(localStorage.getItem('baduk-pro-tsumego-v1')||'{}') as Record<string,unknown>;
   return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v===true]));
 }catch{return {};}
}
export default function ProTsumego(){
 const [id,setId]=useState<string>(()=>{try{const id=localStorage.getItem('baduk-pro:v10:selected');if(id&&ALL_PROBLEMS.some(x=>x.id===id))return id;}catch{/* private browsing */}return INTERMEDIATE_GGG_PROBLEMS[0]!.id;});
 const [level,setLevel]=useState<'hard'|'intermediate'>(()=>id.startsWith('intermediate')?'intermediate':'hard');
 const item=useMemo(()=>ALL_PROBLEMS.find(p=>p.id===id)??ALL_PROBLEMS[0]!,[id]);
 const initial=useMemo(()=>opening(item),[item]);
 const [replay,setReplay]=useState<Replay>(()=>opening(ALL_PROBLEMS.find(p=>p.id===id)??ALL_PROBLEMS[0]!)!.initial);
 const [guess,setGuess]=useState<Coord|null>(null);
 const [hint,setHint]=useState(0);
 const [textFeedback,setTextFeedback]=useState('');
 const [verdict,setVerdict]=useState<'solved'|'alternate'|null>(null);
 const [attempts,setAttempts]=useState(0);
 const [solved,setSolved]=useState<Record<string,boolean>>(savedSolved);
 const [whole,setWhole]=useState(false);
 const [teacherOpen,setTeacherOpen]=useState(false);
 const [lastGuess,setLastGuess]=useState<Coord|null>(null);
 useEffect(()=>{try{window.localStorage.setItem('baduk-pro:last-puzzle',id);window.localStorage.setItem('baduk-pro:v10:selected',id);}catch{/* no storage */}},[id]);
 const currentList=level==='hard'?HARD_GGG_PROBLEMS:INTERMEDIATE_GGG_PROBLEMS;
 const difficulty=level==='hard'?'고급':'중급';
 const dynamicCrop=useMemo(()=>crop(replay.board,initial?.initial.node??replay.node),[replay.board,initial]);
 const viewport=whole&&initial?{startX:0,startY:0,size:initial.n}:dynamicCrop;
 const human=initial?.human??'black';
 const opposite=human==='black'?'white':'black';
 const branches=replay.node.children.filter(c=>moveFromNode(c,human)!==undefined);
 const goodReplies=branches.filter(hasCorrect).map(n=>moveFromNode(n,human)).filter((n):n is Coord=>Boolean(n));
 function open(newItem:Puzzle,newLevel:'hard'|'intermediate'=level){
   const next=opening(newItem);
   if(!next)return;
   setLevel(newLevel);setId(newItem.id);setReplay(next.initial);setGuess(null);setHint(0);setTextFeedback('');setVerdict(null);setAttempts(0);setWhole(false);setLastGuess(null);setTeacherOpen(false);
 }
 function submit(p:Coord){
   if(verdict||!initial)return;
   setGuess(p);setLastGuess(p);
   const line=branches.find(n=>{
     const at=moveFromNode(n,human);
     return at!==undefined&&at!==null&&at.x===p.x&&at.y===p.y;
   });
   if(!line){
     setAttempts(n=>n+1);
     setTextFeedback('이 수는 원본 기보에 없어 좋은 수인지 단정할 수 없어. 아래에서 정답 변화도의 첫 수와 비교해 보자.');setTeacherOpen(true);
     return;
   }
   const changed=simulate(replay.board,human,p,replay.previous);
   if(!changed){setTextFeedback('그 자리는 규칙상 둘 수 없어. 다시 살펴봐.');return;}
   setAttempts(n=>n+1);
   const played=[...replay.moves,{who:human,at:p}];
   if(exactlyCorrect(line)){
     setReplay({board:changed,node:line,moves:played,previous:replay.board});finish(true,played.length);
     return;
   }
   const whiteCandidates=line.children.filter(c=>moveFromNode(c,opposite)!==undefined);
   const defense=whiteCandidates.find(hasCorrect)??whiteCandidates[0]??null;
   if(!hasCorrect(line)){
     // The authored tree records the original author's unsuccessful variations too.
     if(defense){
       const response=moveFromNode(defense,opposite);
       if(response!==undefined){
         const next=simulate(changed,opposite,response,replay.board);
         if(next)setReplay({board:next,node:defense,moves:[...played,{who:opposite,at:response}],previous:changed});
         else setReplay({board:changed,node:line,moves:played,previous:replay.board});
       }
     } else setReplay({board:changed,node:line,moves:played,previous:replay.board});
     setVerdict('alternate');
     setTextFeedback('원본 기보에서는 이 변화가 정답으로 표시되지 않았어. 백의 실제 응수와 정답 경로를 비교해 봐.');setTeacherOpen(true);
     return;
   }
   if(defense){
     const response=moveFromNode(defense,opposite);
     if(response!==undefined){
       const after=simulate(changed,opposite,response,replay.board);
       if(after){
         setReplay({board:after,node:defense,moves:[...played,{who:opposite,at:response}],previous:changed});
         setGuess(null);setHint(0);
         if(exactlyCorrect(defense))finish(true,played.length+1);
         else setTextFeedback('좋아! 원본 기보에 있는 수야. 상대가 응수했어. 다음 수까지 읽어 봐.');
         return;
       }
     }
   }
   setReplay({board:changed,node:line,moves:played,previous:replay.board});
   setGuess(null);setTextFeedback('원본 정답 변화도에 들어 있어! 다음 수를 이어서 읽어 봐.');
 }
 function finish(valid:boolean,stepCount:number){
   if(!valid)return;
   setVerdict('solved');
   setTextFeedback('원본 정답 변화도를 완성했어! 아래에서 백의 응수와 후속 수를 다시 확인해 보자. 총 '+stepCount+'수를 진행했어.');setTeacherOpen(true);
   if(!solved[id]){const next={...solved,[id]:true};setSolved(next);try{localStorage.setItem('baduk-pro-tsumego-v1',JSON.stringify(next));}catch{/* Private Safari */}}
 }
 function next(){
   const idx=currentList.findIndex(p=>p.id===id);
   open(currentList[(idx+1)%currentList.length]!);
 }
 return <section className="pro-wrap">
 <style>{[
   '.pro-wrap{border:1px solid #c5d9c8;background:#fff;border-radius:18px;padding:15px 14px 16px;margin:0 0 12px;color:#2a4234}',
   '.pro-title{font-size:17px;font-weight:950;letter-spacing:-.035em}.pro-intro{font-size:12px;line-height:1.7;color:#6a8070;margin:6px 0 12px}',
   '.pro-levels{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.pro-level{border:1px solid #bfd5c2;background:#f1f7f0;color:#3a7450;border-radius:11px;min-height:48px;font-size:14px;font-weight:900}.pro-level[aria-pressed=true]{background:#285c43;color:white;border-color:#285c43}',
   '.pro-progress{font-size:12px;line-height:1.6;margin:11px 0 8px;display:flex;justify-content:space-between;gap:8px}.pro-progress strong{color:#27583b}.pro-progress span{color:#799380}',
   '.pro-problems{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0 12px}.pro-number{border:1px solid #d5e4d6;background:#f8fbf8;color:#607d62;border-radius:8px;min-width:38px;min-height:38px;font-size:12px;font-weight:800}.pro-number[aria-pressed=true]{background:#d9edda;color:#245d3c;border-color:#79b08a}',
   '.pro-prompt{font-size:14px;line-height:1.65;color:#294832;font-weight:800;margin:11px 0 8px}.pro-board{width:min(100%,355px);height:auto;display:block;margin:8px auto 10px;border-radius:12px;touch-action:manipulation}.pro-board [role=button]{cursor:pointer}',
   '.pro-notice{font-size:12px;line-height:1.75;background:#f2f7f0;color:#41674b;border-radius:10px;padding:10px 11px;margin:9px 0}.pro-result{background:#e7f4e7;color:#26643b}.pro-error{background:#fff2df;color:#8b6133}',
   '.pro-controls{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.pro-btn{font-size:12px;font-weight:850;min-height:40px;border:1px solid #cee0d1;border-radius:9px;padding:9px 11px;color:#39654a;background:#f6faf6}.pro-btn.main{color:#fff;background:#276347;border-color:#276347}.pro-turn{font-size:12px;font-weight:900;background:#e9f4ea;padding:7px 9px;border-radius:9px;color:#2e6744;margin:9px 0}',
   '.pro-original{border-top:1px solid #edf0e8;margin-top:14px;padding-top:10px;color:#849587;font-size:11px;line-height:1.65}.pro-original a{color:#356747;text-decoration:underline}',
   '.pro-original summary{font-size:12px;color:#6d816f;font-weight:800;cursor:pointer}.pro-hint{background:#fff7e7;padding:10px 11px;border-radius:9px;margin:10px 0;color:#6a643d;font-size:12px;line-height:1.7}'
 ].join('')}</style>
 <div className="pro-title">🧠 중급 실전 사활 · 해설 과외</div>
 <p className="pro-intro">중급 실전 문제로 시작해. 답을 외우기보다 <strong>왜 이 자리가 좋은지, 백이 다음에 어디에 두는지</strong> 한 수씩 살펴보자. 어려워도 풀이를 따라가면 돼.</p>
 <div className="pro-levels" role="group" aria-label="실전 사활 난이도">
   <button className="pro-level" type="button" aria-pressed={level==='intermediate'} onClick={()=>open(INTERMEDIATE_GGG_PROBLEMS[0]!, 'intermediate')}>⚔️ 중급 · 18제</button>
   <button className="pro-level" type="button" aria-pressed={level==='hard'} onClick={()=>open(HARD_GGG_PROBLEMS[0]!, 'hard')}>🔥 고급 · 18제</button>
 </div>
 <div className="pro-progress"><strong>{difficulty} · {currentList.findIndex(x=>x.id===id)+1}/18번</strong><span>{currentList.filter(x=>solved[x.id]).length}/18제 해결</span></div>
 <div className="pro-problems">{currentList.map((p,i)=><button key={p.id} type="button" aria-label={difficulty+' '+(i+1)+'번'} aria-pressed={id===p.id} className="pro-number" onClick={()=>open(p)}>{solved[p.id]?'✓':i+1}</button>)}</div>
 <p className="pro-prompt">{human==='black'?'⚫ 흑':'⚪ 백'} 차례 · 다음 상대 수까지 생각하며 직접 바둑판에 둬 봐.</p>
 <div className="pro-turn">현재 {human==='black'?'흑':'백'} 차례 · {replay.moves.length}수 진행 · {attempts}번 시도</div>
 <PuzzleBoard grid={replay.board} cropped={viewport} choice={guess} onPoint={submit} editable={!verdict}/>
 {initial&&dynamicCrop.size<initial.n&&<div style={{fontSize:11,color:'#829486',textAlign:'center'}}>19줄 실전 바둑판의 해당 부분을 확대했어. <button type="button" className="pro-btn" style={{minHeight:32,padding:'5px 8px',marginLeft:4}} onClick={()=>setWhole(v=>!v)}>{whole?'문제 부분 확대':'19줄 전체 보기'}</button></div>}
 {textFeedback&&<div className={'pro-notice'+(verdict==='solved'?' pro-result':verdict==='alternate'?' pro-error':'')} role="status">{textFeedback}</div>}
 <div className="pro-controls"><button type="button" className="pro-btn main" onClick={()=>setTeacherOpen(v=>!v)}>{teacherOpen?'📖 풀이 해설 접기':'📖 왜 정답인지 · 다른 수는 어떤지 보기'}</button></div>
 <SgfLessonWalkthrough key={id} sgf={item.sgf} guess={lastGuess} visible={teacherOpen}/>
 {hint>0&&verdict===null&&<div className="pro-hint">💡 {hint===1?'먼저 내 돌과 상대 돌의 활로를 세어 봐. 이 수를 둔 뒤 상대가 어디에 응수할지도 상상해 봐.':hint===2?'이 문제는 여러 수를 연결해서 생각해야 해. 먼저 돌이 끊기거나 잡힐 위험이 있는 곳을 찾아 봐.':'원본 정답 변화도의 다음 수: '+(goodReplies.map(p=>pointName(p,initial?.n??19)).join(' · ')||'표시되지 않음') }</div>}
 <div className="pro-controls">
   {verdict===null&&<button type="button" className="pro-btn" onClick={()=>setHint(h=>Math.min(3,h+1))}>💡 {hint===0?'힌트 보기':hint===2?'정답 첫 수 보기':'다음 힌트'}</button>}
   <button type="button" className="pro-btn" onClick={()=>open(item)}>↶ 다시 풀기</button>
   <button type="button" className="pro-btn main" onClick={next}>다음 문제 →</button>
 </div>
 <div className="pro-original">※ 19줄 바둑판 중 전투가 있는 부분을 확대해서 보여 줘. <strong>정답 판정은 원본 SGF에 기록된 변화도 기준</strong>이라 기록되지 않은 다른 좋은 수를 모두 판별하지는 못해. <details style={{marginTop:8}}><summary>원문 출처·저작권·해설</summary><p>Go Game Guru Weekly Go Problems · An Younggil &amp; David Ormerod · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a> · 문제 및 원본 기보: <a href={item.source} target="_blank" rel="noreferrer">원본 SGF 보기</a>. 원문 기보의 변화도를 인터랙티브하게 표시하고 한국어 안내를 추가했어.</p>{(replay.node.props.C??[]).filter(c=>!/^Correct$/i.test(c.trim())).map((note,i)=><p key={i}>원문: {note}</p>)}</details></div>
 </section>;
}
