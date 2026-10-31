import {useMemo,useState} from 'react';
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
function StepBoard({board,marker}:{board:BoardState;marker:Point|null}){
 const n=board.length;
 const all:Point[]=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(board[y]?.[x])all.push({x,y});
 if(marker)all.push(marker);
 const left=all.length?Math.min(...all.map(p=>p.x)):0,right=all.length?Math.max(...all.map(p=>p.x)):n-1;
 const top=all.length?Math.min(...all.map(p=>p.y)):0,bottom=all.length?Math.max(...all.map(p=>p.y)):n-1;
 const span=Math.max(9,Math.min(n,Math.max(right-left+3,bottom-top+3)));
 const x0=Math.max(0,Math.min(n-span,Math.round((left+right-span+1)/2)));
 const y0=Math.max(0,Math.min(n-span,Math.round((top+bottom-span+1)/2)));
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
 const solution=useMemo(()=>{try{return answerLine(sgf);}catch{return null;}},[sgf]);
 const authoredResponse=useMemo(()=>{try{return guess?recordedReply(sgf,guess):null;}catch{return null;}},[sgf,guess]);
 if(!visible)return null;
 if(!solution||solution.frames.length===0)return <p>원본 정답 변화도를 분석할 수 없어. 다른 문제를 골라 봐.</p>;
 const n=solution.first.length;
 const frames=solution.frames,at=Math.min(step,frames.length-1),frame=frames[at]!;
 const first=frames[0]!;
 const attempted=guess?put(solution.first,first.color,guess):null;
 const matches=guess&&first.move&&guess.x===first.move.x&&guess.y===first.move.y;
 return <section className="sgf-teacher" aria-label="정답과 오답의 이유를 비교하는 상세 해설">
  <style>{[
   '.sgf-teacher{margin:12px 0;padding:12px 10px;border:1px solid #b9d4bf;background:#f0f7f0;border-radius:13px;color:#335c42}',
   '.sgf-teacher h3{margin:0 0 9px;font-size:14px;color:#2e6341}',
   '.sgf-teacher p{font-size:12px;line-height:1.75;color:#4a6d55;margin:8px 0}',
   '.sgf-teacher .sgf-compare{background:#fff;border:1px solid #e2ede1;border-radius:11px;margin:10px 0;padding:10px}',
   '.sgf-teacher strong{font-size:12px;color:#2e6242}',
   '.sgf-teachboard{width:min(100%,336px);display:block;height:auto;margin:9px auto}',
   '.sgf-stepbuttons{display:flex;gap:7px;margin:10px 0}.sgf-stepbuttons button{flex:1;border:1px solid #c7ddcd;background:#fff;border-radius:9px;min-height:42px;font-weight:850;color:#306849;font-size:12px}.sgf-stepbuttons button:disabled{opacity:.4}',
   '.sgf-teacher .sgf-important{background:#e6f1e6;border-radius:9px;padding:9px}'
  ].join('')}</style>
  <h3>👩‍🏫 왜 정답이고, 왜 다른 수는 아쉬울까?</h3>
  {guess&&<div className="sgf-compare"><strong>① 내가 선택한 첫 수: {coord(guess,n)}</strong>
   {attempted?<><p>내가 두려던 곳에 실제로 두면 이렇게 변해. 이 한 수가 곧바로 돌을 몇 개 잡는지, 내 돌이 단수인지 확인해 보자.</p><StepBoard board={attempted.board} marker={guess}/>
    <p>{describe(attempted,n).slice(1,3).join(' ')}</p></>:<p>이 자리는 이미 돌이 있거나 규칙상 둘 수 없는 자리야.</p>}
   <p>{matches?'이 첫 수는 원본 정답 변화도와 같아! 다음 백의 응수를 보면서 끝까지 읽어 보자.':authoredResponse?'아래는 원본 기보에서 이 선택에 대응한 상대의 실제 기록이야. 정답 경로와 다른 변화를 비교해 보자.':'이 수는 정답 경로와 달라. 다만 원본에 상대 응수가 기록되어 있지 않아, 불리하다고 확정할 수는 없어.'}</p>
   {!matches&&authoredResponse&&<div className="sgf-compare" style={{background:'#fff6e9'}}><strong>⚪ 원본에 기록된 상대의 응수 · {coord(authoredResponse.move,n)}</strong>
    <p>이 자리에 상대가 실제로 두었다고 원본 변화도에 기록돼 있어. <strong>어떤 내 돌이 위험해지는지</strong> 확인하고 정답 경로와 비교해 봐.</p>
    <StepBoard board={authoredResponse.board} marker={authoredResponse.move}/>
    {describe(authoredResponse,n).slice(1,3).map((line,i)=><p key={i}>{line}</p>)}
   </div>}
  </div>}
  <div className="sgf-compare"><strong>② 원본 정답 첫 수: {coord(first.move,n)}</strong><p>이 수가 효과를 발휘하는 건 백의 다음 응수 때문일 수도 있어. 정답 숫자만 보지 말고 이후 판을 비교해 봐.</p><StepBoard board={first.board} marker={first.move}/></div>
  <div className="sgf-compare"><strong>③ 백의 대응까지 한 수씩 보기 · {at+1}/{frames.length}</strong>
   <StepBoard board={frame.board} marker={frame.move}/>
   {describe(frame,n).map((sentence,i)=><p key={i}>{sentence}</p>)}
   <div className="sgf-stepbuttons"><button type="button" disabled={at===0} onClick={()=>setStep(v=>Math.max(0,v-1))}>◀ 이전 수</button><button type="button" disabled={at>=frames.length-1} onClick={()=>setStep(v=>Math.min(frames.length-1,v+1))}>다음 수 ▶</button></div>
  </div>
  <p className="sgf-important"><strong>핵심:</strong> 정답 한 수보다 ‘그 수 → 백의 응수 → 흑의 후속 수’를 연결해서 읽는 게 중요해. 원본 SGF에 기록된 변화도로 확인한 내용이고, 기록되지 않은 수까지 오답이라고 확정하지 않아.</p>
 </section>;
}
