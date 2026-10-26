import { useMemo, useState } from 'react';
import { getLiberties } from './utils/gameLogic';
import type { BoardState, Player } from './types';

type Level = '응용' | '중급' | '도전';
type Puzzle = { id:string;level:Level;size:7|9;title:string;question:string;black:string;white:string;target:string;first:string;reply?:string;second?:string;hints:[string,string];why:string };
const PUZZLES:Puzzle[]=[
{id:'a1',level:'응용',size:7,title:'연결된 두 돌 잡기',question:'노란 백돌 두 개를 한 수에 잡아 봐.',black:'C4 E4 C5 E5 D3',white:'D4 D5',target:'D4',first:'D6',hints:['두 백돌을 한 무리로 보고 활로를 세어 봐.','아래쪽 빈 점이 마지막 활로야.'],why:'연결된 백돌 두 개는 활로를 공유해. 마지막 한 곳을 막으면 둘 다 잡혀.'},
{id:'a2',level:'응용',size:7,title:'단수에서 탈출',question:'단수에 몰린 노란 흑돌 무리를 살아나게 해 봐.',black:'D4 D5',white:'C4 E4 C5 E5 D3',target:'D4',first:'D6',hints:['돌 두 개는 하나의 연결된 무리야.','아래쪽으로 뻗어서 새로운 활로를 만들어 봐.'],why:'아래로 뻗으면 새로운 활로가 늘어나. 단수일 때는 집을 넓히기보다 돌을 살리는 게 먼저야.'},
{id:'a3',level:'응용',size:7,title:'두 무리 연결',question:'떨어진 흑돌 두 개를 서로 연결하는 한 수를 골라 봐.',black:'C4 E4',white:'B3 F5',target:'C4',first:'D4',hints:['대각선으로는 연결된 돌이 아니야.','두 돌 사이에서 양쪽 모두 닿는 곳을 찾아봐.'],why:'돌은 상하좌우로 만나야 연결돼. 두 무리를 하나로 만들면 활로를 함께 쓸 수 있어.'},
{id:'a4',level:'응용',size:7,title:'쌍단수 첫걸음',question:'백돌 두 무리에 동시에 단수를 걸어 봐.',black:'C3 C5 E3 E5',white:'C4 E4',target:'C4',first:'D4',hints:['서로 다른 백돌 두 개의 활로를 각각 세어 봐.','두 백돌 사이에 공통된 빈 점이 있어.'],why:'한 수로 두 개의 백돌 무리를 동시에 단수로 만들었어. 이걸 쌍단수라고 해.'},
{id:'a5',level:'응용',size:7,title:'변에서 잡기',question:'가장자리에 있는 연결된 백돌 두 개를 잡아 봐.',black:'A3 B2 C2 D3 C4',white:'B3 C3',target:'B3',first:'B4',hints:['변에 있는 돌은 판 밖으로 나갈 수 없어.','두 백돌 아래쪽에 남은 빈 점을 찾아봐.'],why:'변과 귀에서는 판 바깥이 활로가 아니야. 남은 한 곳을 막아 두 돌을 함께 잡았어.'},
{id:'m1',level:'중급',size:9,title:'두 곳 동시에 잡기',question:'연결되지 않은 백돌 두 개를 한 수로 동시에 잡아 봐.',black:'C3 C5 B4 E3 E5 F4',white:'C4 E4',target:'C4',first:'D4',hints:['두 백돌 각각의 마지막 활로를 찾아봐.','서로 다른 백돌 두 무리의 활로가 한 점에서 겹쳐.'],why:'한 점이 두 백돌의 마지막 활로였어. 두 군데를 동시에 잡을 수 있는 수를 찾아낸 거야.'},
{id:'m2',level:'중급',size:9,title:'되잡아서 살아나기',question:'노란 흑돌이 단수야. 도망가는 대신 백돌을 잡아 살려 봐.',black:'D4 C3 D2',white:'D3 E4 D5',target:'D4',first:'E3',hints:['흑돌 바로 위의 백돌 D3도 단수야.','백돌을 잡고 나면 그 자리가 비어 활로가 될 수 있어.'],why:'E3으로 백돌을 잡으면 그 백돌이 있던 D3이 빈자리가 돼. 내 돌의 활로가 살아나는 공격이야.'},
{id:'m3',level:'중급',size:9,title:'더 많이 잡는 수',question:'오른쪽 아래에도 백돌이 있어. 어느 한 수가 더 많은 백돌을 잡을까?',black:'C4 D4 E4 B5 F5 C6 E6 F7 G6 H7',white:'C5 D5 E5 G7',target:'D5',first:'D6',hints:['가운데 세 돌은 연결된 한 무리야.','오른쪽 아래 한 돌보다 가운데 세 돌을 한 번에 잡을 곳을 찾아봐.'],why:'한 돌을 잡는 수보다 연결된 세 돌을 잡는 수가 이 문제의 목표에 맞아. 먼저 무리의 크기를 비교해 봐.'},
{id:'m4',level:'중급',size:9,title:'세 무리 동시 연결',question:'서로 떨어진 흑돌 세 무리를 한 수로 이어 봐.',black:'D5 F5 E4',white:'D4 F4 E6',target:'E4',first:'E5',hints:['흑돌 세 곳이 상하좌우로 만날 수 있는 교차점을 찾아봐.','위, 왼쪽, 오른쪽 흑돌 모두에 닿는 자리가 있어.'],why:'E5 한 수가 위·왼쪽·오른쪽의 흑돌을 이어 줘. 공격 전에 연결을 단단히 할 수 있어.'},
{id:'m5',level:'중급',size:9,title:'귀의 수읽기',question:'귀에 있는 연결된 백돌 두 개를 잡아 봐.',black:'A1 B1 C2 B3',white:'A2 B2',target:'A2',first:'A3',hints:['귀에선 판 밖으로 숨 쉴 수 없어.','백돌 두 개를 한 무리로 보면 빈 곳이 하나 남아.'],why:'귀의 백돌 두 개는 아래 한 점만 활로가 있어. 귀를 이용하면 적은 돌로도 포위가 가능해.'},
{id:'c1',level:'도전',size:9,title:'쌍단수 찾기',question:'백돌 하나만 단수로 만들지 말고 두 곳을 동시에 공격해 봐.',black:'D4 D6 F4 F6 B5 H5',white:'D5 F5',target:'D5',first:'E5',hints:['왼쪽과 오른쪽 백돌의 활로를 비교해 봐.','두 백돌 사이의 공통 활로를 찾아봐.'],why:'E5가 두 백돌을 동시에 단수로 몰아. 같은 수로 두 가지 위협을 만드는 게 중요해.'},
{id:'c2',level:'도전',size:9,title:'네 돌과 한 돌',question:'네 돌을 잡는 곳과 한 돌을 잡는 곳 중 더 크게 잡는 자리를 골라 봐.',black:'C5 F5 C6 F6 D4 E4 D7 G3 H2 I3',white:'D5 E5 D6 E6 H3',target:'D5',first:'E7',hints:['연결된 흰 돌 넷은 하나의 큰 무리야.','네 돌 무리 아래의 빈 점이 마지막 활로야.'],why:'E7로 백돌 네 개를 잡았어. 여러 곳에 잡는 수가 있으면 그 효과를 비교하는 습관이 필요해.'},
{id:'c3',level:'도전',size:9,title:'변의 단수 탈출',question:'판 오른쪽에 있는 노란 흑돌은 단수야. 살아나는 자리를 선택해 봐.',black:'H7',white:'G7 H6 I7 E7',target:'H7',first:'H8',hints:['흑돌은 판 안쪽 세 방향이 막혀 있어.','아래로 뻗어서 다른 빈자리를 활로로 만들어 봐.'],why:'H8로 늘면 활로가 생겨. 위험한 내 돌이 있다면 다른 곳보다 구출이 급한 경우가 많아.'},
{id:'c4',level:'도전',size:9,title:'두 수 앞을 읽어라 ①',question:'백돌을 단수로 몰고, 백이 피한 다음 수까지 읽어 잡아 봐.',black:'C4 D3 C5 D6',white:'D4',target:'D4',first:'E4',reply:'D5',second:'E5',hints:['첫 수는 백돌의 활로 두 곳 중 하나를 막는 수야.','백이 아래로 피하면 새로 생긴 마지막 활로를 막으면 돼.'],why:'E4로 단수 → 백 D5 응수 → E5로 백돌 두 개를 잡았어. 상대의 다음 수까지 생각하면 바둑이 달라져.'},
{id:'c5',level:'도전',size:9,title:'두 수 앞을 읽어라 ②',question:'왼쪽 변의 백돌을 단수로 몰고, 백이 아래로 피하면 마무리해 봐.',black:'A4 B3 A5 B6',white:'B4',target:'B4',first:'C4',reply:'B5',second:'C5',hints:['처음에는 백돌의 두 활로 중 하나만 막을 수 있어.','백돌이 아래로 내려가면 한 곳만 남은 활로를 찾아봐.'],why:'C4로 단수 → 백 B5 응수 → C5로 두 백돌을 잡았어. 변에선 판 밖으로 도망갈 수 없어.'},
{id:'c6',level:'도전',size:9,title:'두 수 앞을 읽어라 ③',question:'다른 위치에서도 백이 도망갈 곳을 예측하고 다음 흑수까지 찾아 봐.',black:'E6 F5 E7 F8',white:'F6',target:'F6',first:'G6',reply:'F7',second:'G7',hints:['백돌을 공격할 때는 백이 다음에 둘 빈 곳을 생각해야 해.','백이 아래로 늘면 마지막 활로를 막아 봐.'],why:'G6로 단수 → 백 F7 응수 → G7로 두 백돌을 잡았어. 두 수 읽기에 익숙해지면 더 복잡한 수읽기를 할 수 있어.'}
];
type P={x:number;y:number};
const pos=(s:string):P=>({x:s.charCodeAt(0)-65,y:Number(s.slice(1))-1});
const name=(x:number,y:number)=>String.fromCharCode(65+x)+(y+1);
const match=(p:P|null,t:P)=>Boolean(p&&p.x===t.x&&p.y===t.y);
function makeBoard(p:Puzzle):BoardState{
  const b:BoardState=Array.from({length:p.size},()=>Array.from({length:p.size},()=>null));
  for(const [color,string] of [['black',p.black],['white',p.white]] as const){
    for(const word of string.split(' ')){if(!word)continue;const q=pos(word);b[q.y]![q.x]=color;}
  }
  return b;
}
function place(before:BoardState,p:P,player:Player):BoardState|null{
  if(p.x<0||p.y<0||p.y>=before.length||p.x>=before.length||before[p.y]?.[p.x])return null;
  const b=before.map(row=>row.slice());b[p.y]![p.x]=player;
  const enemy=player==='black'?'white':'black';
  const seen=new Set<string>();
  for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
    const x=p.x+dx,y=p.y+dy;
    if(x<0||y<0||y>=b.length||x>=b.length||b[y]?.[x]!==enemy||seen.has(name(x,y)))continue;
    const g=getLiberties(b,x,y);
    for(const st of g.group)seen.add(name(st.x,st.y));
    if(g.liberties===0)for(const st of g.group)b[st.y]![st.x]=null;
  }
  return getLiberties(b,p.x,p.y).liberties>0?b:null;
}
function loadProgress():Record<string,number>{
  try{const v=JSON.parse(localStorage.getItem('baduk-hard-lessons-v1')||'{}') as Record<string,unknown>;const out:Record<string,number>={};for(const [key,value] of Object.entries(v)){if(typeof value==='number'&&value>=1&&value<=100)out[key]=value;}return out;}
  catch{return {};}
}
function Board({grid,target,selection,onPick}:{grid:BoardState;target:string;selection:P|null;onPick:(x:number,y:number)=>void}){
  const n=grid.length,origin=27,gap=300/(n-1),radius=Math.min(19,gap*.43),mark=pos(target);
  return <svg className="hard-board" viewBox="0 0 354 359" role="group" aria-label="연습 바둑판. 교차점을 눌러 흑돌을 놓으세요">
    <rect width="354" height="359" rx="12" fill="#e8c38d"/>
    {Array.from({length:n},(_,i)=><g key={i} stroke="#8e6d48" strokeWidth="1.2"><line x1={origin} y1={origin+i*gap} x2={origin+(n-1)*gap} y2={origin+i*gap}/><line x1={origin+i*gap} y1={origin} x2={origin+i*gap} y2={origin+(n-1)*gap}/></g>)}
    {Array.from({length:n},(_,i)=><g key={'axis'+i} textAnchor="middle" fill="#715735" fontSize="10" fontWeight="800"><text x={origin+i*gap} y="345">{String.fromCharCode(65+i)}</text><text x="11" y={origin+i*gap+4}>{i+1}</text></g>)}
    {grid.map((row,y)=>row.map((stone,x)=>{
      const xx=origin+x*gap,yy=origin+y*gap;
      return <g key={x+','+y}>
        {stone&&<circle cx={xx} cy={yy} r={radius} fill={stone==='black'?'#202724':'#fafafa'} stroke={stone==='black'?'#181e1a':'#9eaaa0'} strokeWidth="1.2"/>}
        {match(mark,{x,y})&&<circle cx={xx} cy={yy} r={radius+3} fill="none" stroke="#cc901f" strokeWidth="3.5" strokeDasharray="5 3"/>}
        {match(selection,{x,y})&&<circle cx={xx} cy={yy} r={radius+4} fill="none" stroke="#298858" strokeWidth="3"/>}
        {!stone&&<circle cx={xx} cy={yy} r={Math.max(14,gap*.48)} fill="transparent" role="button" tabIndex={0} aria-label={name(x,y)+'에 두기'} onClick={()=>onPick(x,y)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(x,y);}}}/>}
      </g>;
    }))}
  </svg>;
}
export default function AdvancedLessons(){
  const [id,setId]=useState('m1');
  const lesson=useMemo(()=>PUZZLES.find(p=>p.id===id)??PUZZLES[5]!,[id]);
  const [grid,setGrid]=useState<BoardState>(()=>makeBoard(PUZZLES[5]!));
  const [step,setStep]=useState(0);
  const [selected,setSelected]=useState<P|null>(null);
  const [wrong,setWrong]=useState(0);
  const [hint,setHint]=useState(0);
  const [message,setMessage]=useState('');
  const [solved,setSolved]=useState(false);
  const [progress,setProgress]=useState<Record<string,number>>(loadProgress);
  const group=PUZZLES.filter(p=>p.level===lesson.level);
  const shownIndex=group.findIndex(p=>p.id===id);
  const count=PUZZLES.filter(p=>progress[p.id]).length;
  const targetStep=step===0?lesson.first:(lesson.second??lesson.first);
  function open(p:Puzzle){
    setId(p.id);setGrid(makeBoard(p));setStep(0);setSelected(null);setWrong(0);setHint(0);setMessage('');setSolved(false);
  }
  function move(x:number,y:number){
    if(solved)return;
    const p={x,y};setSelected(p);
    const b=place(grid,p,'black');
    if(!b){setMessage('지금 둘 수 없는 자리야. 다른 빈자리를 골라 봐.');return;}
    if(!match(p,pos(targetStep))){setWrong(v=>v+1);setMessage('이 문제의 목표에는 아직 맞지 않는 수야. 노란 표시 주변의 활로를 다시 세어 봐.');return;}
    if(step===0&&lesson.reply&&lesson.second){
      const withWhite=place(b,pos(lesson.reply),'white');
      if(!withWhite){setMessage('백의 응수를 계산하지 못했어. 다른 문제로 넘어가 봐.');return;}
      setGrid(withWhite);setStep(1);setSelected(null);setHint(0);
      setMessage('좋아! 흑 '+lesson.first+'에 뒀고, 백은 '+lesson.reply+'로 피했어. 이제 흑의 마무리 수를 골라 봐.');
      return;
    }
    setGrid(b);setSelected(null);setSolved(true);setMessage('정답! '+lesson.why);
    if(!progress[id]||wrong+1<progress[id]){
      const next={...progress,[id]:wrong+1};setProgress(next);
      try{localStorage.setItem('baduk-hard-lessons-v1',JSON.stringify(next));}catch{/* storage may be disabled */}
    }
  }
  const CSS=[
    '.hard-wrap{background:#fff;border:1px solid #d8e5d8;border-radius:16px;padding:16px 13px;margin:0 0 15px;color:#2f4435}',
    '.hard-title{font-size:17px;font-weight:900;letter-spacing:-.03em}.hard-sub{font-size:12px;line-height:1.7;color:#738878;margin:7px 0 12px}',
    '.hard-levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.hard-level{background:#f7faf7;border:1px solid #d3e3d5;border-radius:10px;min-height:48px;font-weight:900;color:#476e52;font-size:13px}.hard-level small{display:block;font-size:10px;font-weight:500}.hard-level[aria-pressed=true]{color:white;background:#2e684a;border-color:#2e684a}',
    '.hard-counter{font-size:12px;display:flex;justify-content:space-between;gap:5px;margin:14px 0 9px;color:#647c69}.hard-counter strong{color:#2f6344}',
    '.hard-picks{display:flex;gap:6px;flex-wrap:wrap}.hard-pick{min-height:37px;background:#f7faf7;color:#53725a;border:1px solid #d4e4d5;border-radius:9px;padding:6px 10px;font-size:11px;font-weight:800}.hard-pick[aria-pressed=true]{color:#245b3b;background:#e3f3e7;border-color:#80af89}',
    '.hard-q{font-size:15px;font-weight:900;margin:16px 0 6px;color:#33543c}.hard-desc{font-size:13px;color:#4e6554;line-height:1.7;margin:0 0 9px}.hard-phase{color:#306643;background:#eaf4ec;border-radius:9px;font-size:12px;font-weight:850;padding:8px 10px;margin:8px 0}',
    '.hard-board{width:min(100%,350px);height:auto;display:block;margin:9px auto;border-radius:12px;touch-action:manipulation}.hard-board [role=button]{cursor:pointer}',
    '.hard-message{font-size:13px;line-height:1.7;border-radius:10px;color:#88673d;background:#fff3e3;padding:11px;margin:10px 0}.hard-message.success{background:#e6f3e9;color:#306a46}',
    '.hard-hint{font-size:12px;line-height:1.65;background:#f0f5ec;padding:11px;border-radius:9px;color:#476d4e;margin:9px 0}',
    '.hard-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.hard-btn{border:1px solid #d3e4d6;background:#f5f9f5;color:#326443;border-radius:9px;min-height:40px;padding:9px 11px;font-size:12px;font-weight:850}.hard-btn.main{background:#2f684b;border-color:#2f684b;color:white}',
    '.hard-footer{font-size:11px;line-height:1.7;color:#8b9c8e;margin:12px 0 0}'
  ].join('');
  return <section className="hard-wrap" aria-label="바둑 전술 심화 연습">
    <style>{CSS}</style>
    <div className="hard-title">🧠 전술 문제 · 진짜 수읽기</div>
    <p className="hard-sub">귀 찾기는 졸업! 이제 연결, 쌍단수, 잡으면서 살기, 두 수 앞 수읽기를 연습해. 중급부터 시작해!</p>
    <div className="hard-levels" role="group" aria-label="난이도 선택">
      {(['응용','중급','도전'] as const).map(level=><button type="button" key={level} className="hard-level" aria-pressed={lesson.level===level} onClick={()=>open(PUZZLES.find(p=>p.level===level)!)}>{level}<small>{PUZZLES.filter(p=>p.level===level&&progress[p.id]).length}/{PUZZLES.filter(p=>p.level===level).length} 완료</small></button>)}
    </div>
    <div className="hard-counter"><strong>{lesson.level} {shownIndex+1}/{group.length}</strong><span>전체 {count}/{PUZZLES.length} 완료</span></div>
    <div className="hard-picks" role="group" aria-label="문제 목록">{group.map((p,i)=><button type="button" className="hard-pick" aria-pressed={p.id===id} key={p.id} onClick={()=>open(p)}>{progress[p.id]?'✓ ':''}{i+1}. {p.title}</button>)}</div>
    <div className="hard-q">{lesson.title}</div>
    <p className="hard-desc">{lesson.question}</p>
    {lesson.second&&<div className="hard-phase">두 수 읽기 · {step+1}/2단계 {step===1?'(백의 응수를 반영했어)':''}</div>}
    <Board grid={grid} target={lesson.target} selection={selected} onPick={move}/>
    {message&&<p className={'hard-message'+(solved||step===1?' success':'')} role="status">{message}</p>}
    {hint>0&&!solved&&<p className="hard-hint">{hint===1?lesson.hints[0]:hint===2?lesson.hints[1]:'정답 확인: 지금은 '+targetStep+'에 두는 수를 생각해 봐.'}</p>}
    <div className="hard-actions">
      {!solved&&<button type="button" className="hard-btn" onClick={()=>setHint(h=>Math.min(3,h+1))}>💡 {hint===0?'힌트 보기':hint===3?'정답 다시 보기':'다음 힌트'}</button>}
      <button type="button" className="hard-btn" onClick={()=>open(lesson)}>↶ 다시 풀기</button>
      <button type="button" className="hard-btn main" onClick={()=>open(PUZZLES[(PUZZLES.indexOf(lesson)+1)%PUZZLES.length]!)}>{solved?'다음 문제 →':'다른 문제 →'}</button>
    </div>
    <p className="hard-footer">틀려도 감점은 없어. 정답 수는 바둑판에 반영되고, 두 수 문제에서는 백이 실제로 응수해. 완료 기록은 이 Safari에만 보관돼.</p>
  </section>;
}
