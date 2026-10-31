import {useEffect,useMemo,useState} from 'react';
import {getLiberties,applyCapturesInPlace,isValidMove} from './utils/gameLogic';
import {parseSgf,type ParsedSgfNode} from './utils/sgf';
import type {BoardState,Player} from './types';

type Point={x:number;y:number};
type Frame={board:BoardState;color:Player;move:Point|null;captured:number;liberties:number;groupSize:number;atari:number};
const LETTERS='ABCDEFGHJKLMNOPQRST';
const coord=(p:Point|null,n:number)=>p?LETTERS[p.x]+(n-p.y):'패스';
function point(s:string):Point|null{return !s||s==='tt'?null:{x:s.charCodeAt(0)-97,y:s.charCodeAt(1)-97};}
function move(node:ParsedSgfNode):{color:Player;at:Point|null}|null{
 if(node.props.B?.length)return {color:'black',at:point(node.props.B[0]!)};
 if(node.props.W?.length)return {color:'white',at:point(node.props.W[0]!)};
 return null;
}
function hasCorrect(node:ParsedSgfNode):boolean{
 const stack=[node];let count=0;
 while(stack.length&&count++<1200){
  const n=stack.pop()!;
  if((n.props.C??[]).some(v=>/\bCorrect\b/i.test(v)))return true;
  stack.push(...n.children);
 }
 return false;
}
function atariCount(board:BoardState,color:Player):number{
 let result=0,seen=new Set<string>();
 for(let y=0;y<board.length;y++)for(let x=0;x<board.length;x++){
  if(board[y]?.[x]!==color||seen.has(x+','+y))continue;
  const g=getLiberties(board,x,y);
  for(const q of g.group)seen.add(q.x+','+q.y);
  if(g.liberties===1)result++;
 }
 return result;
}
function put(board:BoardState,color:Player,at:Point|null):Frame|null{
 if(at===null)return {board:board.map(r=>r.slice()),color,move:at,captured:0,liberties:0,groupSize:0,atari:0};
 if(!isValidMove(board,at.x,at.y,color))return null;
 const b=board.map(r=>r.slice());
 b[at.y]![at.x]=color;
 const captured=applyCapturesInPlace(b,at.x,at.y,color);
 const g=getLiberties(b,at.x,at.y);
 return {board:b,color,move:at,captured:captured.length,liberties:g.liberties,groupSize:g.group.length,atari:atariCount(b,color==='black'?'white':'black')};
}
function recordedReply(sgf:string,guess:Point):Frame|null{
 const parsed=parseSgf(sgf);
 if(!parsed.tree)return null;
 const root=parsed.initialBoard;
 const branch=parsed.tree.children.find(node=>{
  const m=move(node);
  return m?.at?.x===guess.x&&m.at.y===guess.y;
 });
 if(!branch)return null;
 const choice=move(branch);
 if(!choice)return null;
 const placed=put(root,choice.color,choice.at);
 if(!placed)return null;
 const opponent=branch.children.find(n=>{const m=move(n);return m&&m.color!==choice.color;});
 if(!opponent)return null;
 const response=move(opponent);
 if(!response)return null;
 return put(placed.board,response.color,response.at);
}

function answerLine(sgf:string):{first:BoardState;frames:Frame[]}|null{
 const parsed=parseSgf(sgf);
 if(!parsed.tree)return null;
 const frames:Frame[]=[],first=parsed.initialBoard.map(r=>r.slice());
 let cur=parsed.tree,b=first;
 for(let i=0;i<16;i++){
  const next=cur.children.find(hasCorrect);
  if(!next)break;
  const m=move(next);if(!m)break;
  const after=put(b,m.color,m.at);if(!after)break;
  frames.push(after);
  b=after.board;cur=next;
  if((cur.props.C??[]).some(v=>/\bCorrect\b/i.test(v)))break;
 }
 return {first,frames};
}
function StepBoard({board,marker,viewport}:{board:BoardState;marker:Point|null;viewport?:{x0:number;y0:number;span:number}}){
 const n=board.length;
 const all:Point[]=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(board[y]?.[x])all.push({x,y});
 if(marker)all.push(marker);
 const left=all.length?Math.min(...all.map(p=>p.x)):0,right=all.length?Math.max(...all.map(p=>p.x)):n-1;
 const top=all.length?Math.min(...all.map(p=>p.y)):0,bottom=all.length?Math.max(...all.map(p=>p.y)):n-1;
 const span=viewport?.span??Math.max(9,Math.min(n,Math.max(right-left+3,bottom-top+3)));
 const x0=viewport?.x0??Math.max(0,Math.min(n-span,Math.round((left+right-span+1)/2)));
 const y0=viewport?.y0??Math.max(0,Math.min(n-span,Math.round((top+bottom-span+1)/2)));
 const gap=310/(span-1),r=Math.min(16,gap*.45),o=27;
 return <svg className="sgf-teachboard" viewBox="0 0 368 372" role="img" aria-label="이 수 이후 바둑판">
  <rect width="368" height="372" rx="10" fill="#e6c38f"/>
  {Array.from({length:span},(_,i)=><g key={i} stroke="#886842" strokeWidth="1"><line x1={o} y1={o+i*gap} x2={o+310} y2={o+i*gap}/><line x1={o+i*gap} y1={o} x2={o+i*gap} y2={o+310}/></g>)}
  {Array.from({length:span},(_,i)=><g key={'axis'+i} textAnchor="middle" fontSize="10" fill="#695232"><text x={o+i*gap} y="356">{LETTERS[x0+i]}</text><text x="11" y={o+i*gap+4}>{n-y0-i}</text></g>)}
  {Array.from({length:span*span},(_,idx)=>{
   const x=x0+idx%span,y=y0+Math.floor(idx/span),v=board[y]?.[x],xx=o+(x-x0)*gap,yy=o+(y-y0)*gap,focus=marker?.x===x&&marker.y===y;
   return <g key={idx}>{v&&<circle cx={xx} cy={yy} r={r} fill={v==='black'?'#232b25':'#fafafa'} stroke={v==='black'?'#1b231d':'#b1b4a9'}/>}
    {focus&&<circle cx={xx} cy={yy} r={r+3} fill="none" stroke="#20875a" strokeWidth="3.4"/>}</g>;
  })}
 </svg>;
}
function describe(frame:Frame,n:number):string[]{
 const name=(frame.color==='black'?'흑':'백')+' '+coord(frame.move,n),result:string[]=[];
 result.push(name+'에 둔 다음의 실제 판을 보여주고 있어.');
 if(frame.captured>0)result.push('이 수로 상대 돌 '+frame.captured+'개를 잡았어. 상대 돌무리의 마지막 빈 점이 막혔기 때문이야.');
 else if(frame.atari>0)result.push('현재 상대 돌 중 단수인 무리가 '+frame.atari+'개 있어. 다만 이번 수가 전부를 새로 단수로 만든 것은 아닐 수 있어.');
 if(frame.move){
  if(frame.liberties===1)result.push('방금 둔 돌이 속한 무리의 활로는 단 1개야. 상대가 그곳을 막으면 위험하므로 다음 응수를 꼭 봐야 해.');
  else result.push('방금 둔 돌이 속한 무리의 활로는 '+frame.liberties+'개이고, 이 무리는 돌 '+frame.groupSize+'개가 연결돼 있어.');
 }
 result.push(frame.color==='black'?'다음에 백이 어디를 막을지 보고 그 자리의 의미를 찾아봐.':'백이 이렇게 대응했다면 흑은 어디에 이어서 두어야 할까?');
 return result;
}
export default function SgfLessonWalkthrough({sgf,guess,visible}:{sgf:string;guess:Point|null;visible:boolean}){
 const [step,setStep]=useState(0);
 const [view,setView]=useState<'initial'|'mine'|'reply'|'answer'>('answer');
 const solution=useMemo(()=>{try{return answerLine(sgf);}catch{return null;}},[sgf]);
 const authoredResponse=useMemo(()=>{try{return guess?recordedReply(sgf,guess):null;}catch{return null;}},[sgf,guess]);
 useEffect(()=>{setStep(0);setView(guess?'mine':'answer');},[guess,sgf]);
 const viewport=useMemo(()=>{
  if(!solution)return undefined;
  const boards=[solution.first,...solution.frames.map(f=>f.board)];
  const seen:Point[]=[];
  for(const b of boards)for(let y=0;y<b.length;y++)for(let x=0;x<b.length;x++)if(b[y]?.[x])seen.push({x,y});
  if(guess)seen.push(guess);
  if(!seen.length)return undefined;
  const n=solution.first.length,left=Math.min(...seen.map(p=>p.x)),right=Math.max(...seen.map(p=>p.x)),top=Math.min(...seen.map(p=>p.y)),bottom=Math.max(...seen.map(p=>p.y));
  const span=Math.min(n,Math.max(9,right-left+3,bottom-top+3));
  return {x0:Math.max(0,Math.min(n-span,Math.round((left+right-span+1)/2))),y0:Math.max(0,Math.min(n-span,Math.round((top+bottom-span+1)/2))),span};
 },[solution,guess]);
 if(!visible)return null;
 if(!solution||solution.frames.length===0)return <p>원본 정답 변화도를 분석할 수 없어. 다른 문제를 골라 봐.</p>;
 const n=solution.first.length,frames=solution.frames;
 const at=Math.min(step,frames.length-1),frame=frames[at]!;
 const first=frames[0]!,attempted=guess?put(solution.first,first.color,guess):null;
 const matches=Boolean(guess&&first.move&&guess.x===first.move.x&&guess.y===first.move.y);
 const currentBoard=view==='initial'?solution.first:view==='mine'?(attempted?.board??solution.first):view==='reply'?(authoredResponse?.board??solution.first):frame.board;
 const marker=view==='initial'?null:view==='mine'?guess:view==='reply'?(authoredResponse?.move??null):frame.move;
 const viewTitle=view==='initial'?'① 착수 전 바둑판':view==='mine'?('② 내가 둔 '+coord(guess,n)):view==='reply'?('③ 상대의 응수 '+coord(authoredResponse?.move??null,n)):('✅ 정답 수순 '+(at+1)+'/'+frames.length);
 const firstEffect=describe(first,n).slice(1,3).join(' ');
 const mineEffect=attempted?describe(attempted,n).slice(1,3).join(' '):'이 자리는 현재 규칙상 둘 수 없는 자리야.';
 const whiteEffect=authoredResponse?describe(authoredResponse,n).slice(1,3).join(' '):'원본에 이 선택의 상대 응수가 기록되어 있지 않아.';
 return <section className="sgf-teacher" aria-label="정답과 다른 수를 한 판에서 비교하는 상세 해설">
  <style>{[
   '.sgf-teacher{margin:10px 0;padding:12px;border:1px solid #bfd8c4;background:#f3f9f2;border-radius:13px;color:#335c42}',
   '.sgf-teacher h3{margin:0 0 7px;font-size:15px;color:#2e6341}',
   '.sgf-teacher p{font-size:12px;line-height:1.75;color:#4b6d54;margin:7px 0}',
   '.sgf-teacher .sgf-stage{font-weight:900;color:#2f6748;margin:10px 0 4px;font-size:13px}',
   '.sgf-teacher .sgf-views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:11px 0}',
   '.sgf-teacher .sgf-views button{background:white;border:1px solid #cadfcc;color:#39684a;border-radius:9px;min-height:40px;font-size:12px;font-weight:850;padding:6px 8px}',
   '.sgf-teacher .sgf-views button[aria-pressed=true]{background:#28664b;color:white;border-color:#28664b}',
   '.sgf-teacher .sgf-views button:disabled{opacity:.4}',
   '.sgf-teachboard{width:min(100%,345px);display:block;height:auto;margin:8px auto;border-radius:10px}',
   '.sgf-teacher .sgf-point{background:#fff;border:1px solid #dde8db;border-radius:10px;padding:10px 11px}',
   '.sgf-stepbuttons{display:flex;gap:7px;margin:10px 0}.sgf-stepbuttons button{flex:1;border:1px solid #c7ddcd;background:#fff;border-radius:9px;min-height:42px;font-weight:850;color:#306849;font-size:12px}.sgf-stepbuttons button:disabled{opacity:.4}',
   '.sgf-teacher .sgf-important{background:#e5f0e5;border-radius:9px;padding:9px}'
  ].join('')}</style>
  <h3>👩‍🏫 왜 이 수가 정답이고, 다른 수는 어떨까?</h3>
  <p>같은 판을 바꿔 가며 비교해 보자. <strong>착수 전 → 내 선택 → 백의 응수 → 정답 수순</strong>을 눌러 확인할 수 있어. 바둑판이 여러 개 쌓이지 않게 한 장만 보여줘.</p>
  <div className="sgf-views" role="group" aria-label="한 바둑판으로 변화 비교">
    <button type="button" aria-pressed={view==='initial'} onClick={()=>setView('initial')}>처음 상태</button>
    <button type="button" disabled={!guess} aria-pressed={view==='mine'} onClick={()=>setView('mine')}>내가 둔 수</button>
    <button type="button" disabled={!authoredResponse} aria-pressed={view==='reply'} onClick={()=>setView('reply')}>백의 응수</button>
    <button type="button" aria-pressed={view==='answer'} onClick={()=>setView('answer')}>정답 변화도</button>
  </div>
  <div className="sgf-stage">{viewTitle}</div>
  <StepBoard board={currentBoard} marker={marker} viewport={viewport}/>
  <div className="sgf-point" role="status">
    {view==='initial'&&<>
      <strong>먼저 어디가 위험한지 찾아보자</strong>
      <p>연결된 돌무리는 하나로 보고 활로를 세어 봐. 지금 잡는 것만 생각하지 말고 상대가 다음에 어디에 둘지도 상상해 보자.</p>
    </>}
    {view==='mine'&&<>
      <strong>내가 둔 수의 실제 효과</strong><p>{mineEffect}</p>
      <p>{matches?'이 자리는 원본의 정답 첫 수와 같아. 하지만 이 한 수만으로 정답인 건 아니야. 백의 다음 수와 흑의 후속 수까지 확인해야 해.':authoredResponse?'이 자리에서는 원본 기보에 백의 대응이 기록되어 있어. ‘백의 응수’를 눌러 어디를 공격하는지 확인해 봐.':'이 수에 대한 상대의 응수가 원본에 기록되어 있지 않아. 틀렸다고 확정하지 않고 정답 수순과 비교해 보자.'}</p>
    </>}
    {view==='reply'&&<>
      <strong>상대는 이렇게 대응할 수 있어</strong><p>기보에 기록된 상대가 {coord(authoredResponse?.move??null,n)}에 둔 변화야. {whiteEffect}</p>
      <p>처음 판과 비교해서 누가 먼저 중요한 빈점을 차지했는지, 어느 돌무리의 활로가 줄었는지 확인해 봐. 이 기록만으로 모든 다른 수가 패배한다고 단정할 수는 없어.</p>
    </>}
    {view==='answer'&&<>
      <strong>{at===0?'정답의 첫 번째 선택':'왜 이다음 수가 필요한지 알아보자'}</strong>
      <p>{at===0?firstEffect:describe(frame,n).slice(1,3).join(' ')}</p>
      <p>{frame.color==='black'?'흑의 목적을 확인했으면 다음에 백이 어떻게 대응하는지 보자.':'백이 이렇게 응수하면 흑은 무엇을 해야 할까? 다음 흑수를 보기 전에 직접 생각해 보자.'}</p>
      {at===frames.length-1&&<p>이 장면까지가 원본에 <strong>정답으로 기록된 수순</strong>이야. 포획·활로는 실제 판에서 계산했고, 사활 전체의 전략적 이유를 모두 증명하는 것은 아니야.</p>}
    </>}
  </div>
  {view==='answer'&&<div className="sgf-stepbuttons">
    <button type="button" disabled={at===0} onClick={()=>setStep(i=>Math.max(0,i-1))}>◀ 이전 수</button>
    <button type="button" disabled={at>=frames.length-1} onClick={()=>setStep(i=>Math.min(frames.length-1,i+1))}>다음 수 ▶</button>
  </div>}
  <p className="sgf-important"><strong>기억할 원칙:</strong> 한 수가 아니라, 그 수를 둔 뒤 백의 응수와 흑의 후속 수까지 연결해서 읽기. 다른 수에 대한 기록이 없으면 오답이라고 단정하지 않기.</p>
 </section>;
}
