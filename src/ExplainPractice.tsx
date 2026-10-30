import {useEffect,useMemo,useState} from 'react';
import {applyCapturesInPlace,getLiberties,isValidMove} from './utils/gameLogic';
import type {BoardState,Player} from './types';

type Choice={at:string;why:string;white?:string;consequence?:string};
type Lesson={
 id:string;title:string;goal:string;black:string;white:string;focus:string;
 best:Choice;others:[Choice,Choice];rule:string;question:string;size:7|9;
};
const LESSONS:Lesson[]=[
 {id:'s1',title:'백돌을 잡을 기회',goal:'백돌 두 개가 도망치기 전에 무엇을 해야 할까?',black:'C4 E4 C5 E5 D3',white:'D4 D5',focus:'지금 백돌 D4·D5는 연결된 한 무리야. 무리 전체의 빈 칸(활로)을 세어 봐.',best:{at:'D6',why:'D4·D5의 마지막 활로는 D6 하나야. 여기를 막으면 두 백돌이 한꺼번에 잡혀.'},others:[{at:'A1',why:'빈 귀를 차지하는 수지만, 지금 당장 잡을 수 있는 백돌을 놓쳐.',white:'D6',consequence:'백이 D6으로 뻗으면 백돌이 도망갈 활로가 새로 생겨.'},{at:'G7',why:'멀리 떨어진 새 공간에 두는 수야. 백돌의 마지막 활로 D6은 그대로 남아.',white:'D6',consequence:'백이 D6에 먼저 두면 바로 잡을 기회가 사라져.'}],rule:'상대 돌무리의 활로가 하나뿐이면, 마지막 한 점을 확인하자.',question:'백돌 D4와 D5를 따로 보면 안 되는 이유는?',size:7},
 {id:'s2',title:'공간보다 내 돌',goal:'내 흑돌 두 개가 단수야. 지금은 무엇을 먼저 해야 할까?',black:'D4 D5',white:'C4 E4 C5 E5 D3',focus:'흑돌 D4·D5는 한 무리이고 마지막 활로가 D6 하나야. 백이 먼저 D6에 두면?',best:{at:'D6',why:'D6으로 늘면 연결된 흑돌 무리의 활로가 늘어나서 바로 잡히지 않아.'},others:[{at:'A1',why:'귀를 차지하더라도 단수에 걸린 흑돌 두 개를 방치해.',white:'D6',consequence:'백이 D6에 두면 흑돌 D4·D5의 마지막 활로가 막혀 둘 다 잡혀.'},{at:'G7',why:'이곳에 새 돌을 놓는 건 가능하지만 지금 잡힐 돌은 살리지 못해.',white:'D6',consequence:'백이 마지막 활로 D6을 막으면 흑돌 두 개가 잡혀.'}],rule:'내 돌이 단수면 다른 데 집을 벌리기 전에 먼저 살릴 방법을 확인하자.',question:'흑돌 두 개가 따로 있는 게 아니라 한 무리라는 사실이 중요한 이유는?',size:7},
 {id:'s3',title:'돌을 연결할 타이밍',goal:'두 흑돌을 하나로 이어서 안전하게 만들려면?',black:'C4 E4',white:'B3 F5',focus:'흑돌 C4와 E4는 떨어져 있어. 바둑에서는 대각선이 아니라 상하좌우로 이어져야 연결돼.',best:{at:'D4',why:'D4는 양쪽 흑돌에 동시에 닿아 두 개의 무리를 하나로 이어 줘.'},others:[{at:'C5',why:'C4와만 연결돼서 오른쪽 흑돌 E4는 여전히 따로 남아 있어.',white:'D4',consequence:'백이 사이의 D4를 차지하면 두 흑돌을 직접 잇는 길이 막혀.'},{at:'E5',why:'E4에서 아래로 뻗지만 왼쪽 C4와 연결되지는 않아.',white:'D4',consequence:'백이 D4에 먼저 놓으면 흑돌 둘 사이를 차지해 연결하기 불편해져.'}],rule:'서로 떨어진 내 돌이 있다면 한 수로 연결할 수 있는 자리가 있는지 찾아보자.',question:'C5에 두는 것과 D4에 두는 것의 차이는?',size:7},
 {id:'s4',title:'한 수로 두 곳 공격',goal:'떨어진 백돌 두 무리를 한꺼번에 단수로 만들려면?',black:'C3 C5 E3 E5',white:'C4 E4',focus:'왼쪽 C4와 오른쪽 E4는 각각 활로가 두 군데야. 둘 다 영향을 받는 자리가 있어.',best:{at:'D4',why:'D4는 왼쪽 C4와 오른쪽 E4의 공통 활로야. 한 수로 두 백돌을 모두 단수로 몰아.'},others:[{at:'B4',why:'왼쪽 C4의 활로를 줄이지만 오른쪽 E4는 그대로 두어.',white:'D4',consequence:'백이 가운데 D4에 두면 서로 떨어진 백돌이 연결돼 공격하기 어려워져.'},{at:'F4',why:'오른쪽 E4만 공격해. 왼쪽 C4까지 동시에 압박하지는 못해.',white:'D4',consequence:'백이 D4에 먼저 두면 두 백돌을 연결해 버려.'}],rule:'내 수가 두 군데에 동시에 영향을 주는지 확인해 보자. (쌍단수)',question:'D4가 B4나 F4보다 목표에 맞는 이유는?',size:7},
 {id:'s5',title:'가장자리의 마지막 숨구멍',goal:'변에 있는 연결된 백돌 두 개를 잡아 봐.',black:'A3 B2 C2 D3 C4',white:'B3 C3',focus:'B3·C3은 한 무리야. 판 밖은 활로로 세지 않는다는 점을 기억해.',best:{at:'B4',why:'B4가 B3·C3 무리의 마지막 활로야. 여기에 흑을 두면 두 백돌이 잡혀.'},others:[{at:'A4',why:'백돌 왼쪽으로 접근하지만 마지막 활로 B4를 막지 못해.',white:'B4',consequence:'백이 B4에 연결해서 도망갈 활로를 늘릴 수 있어.'},{at:'E4',why:'백돌 가까이에 두는 것 같지만 B4는 계속 열려 있어.',white:'B4',consequence:'백이 마지막 활로 쪽으로 늘면 지금 잡을 수 있는 기회를 놓쳐.'}],rule:'귀와 변에서는 판의 바깥쪽이 활로가 아니므로 더 적은 돌로도 포위할 수 있어.',question:'B3·C3을 잡는 데 왜 B4 하나면 충분할까?',size:7},
 {id:'s6',title:'하나가 아니라 두 군데 잡기',goal:'서로 연결되지 않은 백돌 두 개를 한 수에 잡을 수 있을까?',black:'C3 C5 B4 E3 E5 F4',white:'C4 E4',focus:'C4와 E4는 별개의 백돌 무리지만, 두 무리의 마지막 활로가 같은 점이야.',best:{at:'D4',why:'왼쪽 C4와 오른쪽 E4 각각의 마지막 활로가 D4야. 두 백돌을 한 번에 잡아.'},others:[{at:'A1',why:'귀에 돌을 추가하지만 지금 백돌을 한꺼번에 잡을 기회를 놓쳐.',white:'D4',consequence:'백이 D4를 차지하면 두 백돌이 한 무리로 연결돼 활로가 늘어나.'},{at:'H8',why:'반대편을 넓히는 수로, 가운데 백돌의 마지막 활로에는 영향이 없어.',white:'D4',consequence:'백이 D4로 이어 버리면 두 백돌을 잡기 어려워져.'}],rule:'서로 다른 돌무리도 마지막 활로가 같은 점이라면 한 수에 여러 무리를 잡을 수 있어.',question:'백돌 두 개가 서로 연결되어 있지 않은데 왜 동시에 잡히지?',size:9},
 {id:'s7',title:'도망갈까, 되잡을까?',goal:'노란 표시 없이 판을 보고, 단수에 걸린 흑돌 D4를 구해 봐.',black:'D4 C3 D2',white:'D3 E4 D5',focus:'흑돌 D4의 활로는 C4 하나뿐이야. 그런데 바로 위 백돌 D3도 활로가 한 곳뿐이야.',best:{at:'E3',why:'E3으로 백돌 D3을 먼저 잡으면 D3 자리가 비어 흑돌 D4의 활로가 늘어나. 도망 대신 잡아서 사는 방법이야.'},others:[{at:'C4',why:'흑돌을 왼쪽으로 늘려 단수를 벗어나는 합법적인 수야. 다만 이번 목표인 \'상대 백돌을 잡으면서 내 돌을 살리기\'에는 E3이 더 직접적이야.'},{at:'A1',why:'멀리 떨어진 귀를 차지하면 단수에 걸린 흑돌을 구할 수 없어.',white:'C4',consequence:'백이 C4에 두면 D4의 마지막 활로가 막혀 흑돌이 잡혀.'}],rule:'단수일 때 무조건 도망가지 말고, 상대도 단수인지 먼저 살펴보자.',question:'E3에서 잡힌 백돌이 사라진 뒤 D4의 활로는 어떻게 바뀌지?',size:9},
 {id:'s8',title:'더 크게 잡는 수 비교',goal:'지금 한 수로 더 많은 백돌을 잡는 곳은?',black:'C4 D4 E4 B5 F5 C6 E6 F7 G6 H7',white:'C5 D5 E5 G7',focus:'중앙에는 백돌 세 개가 연결돼 있고, 오른쪽 아래에는 백돌 하나가 있어.',best:{at:'D6',why:'D6에 두면 C5·D5·E5 세 백돌의 마지막 활로가 막혀 한꺼번에 잡혀.'},others:[{at:'G8',why:'이 수 역시 백돌 G7 한 개를 잡는 좋은 수야! 다만 이번 목표인 \'한 수로 더 많이 잡기\'에서는 D6의 세 개보다 작아.'},{at:'A1',why:'귀에 두는 것보다 지금은 백돌 세 개를 잡을 기회가 뚜렷해.',white:'D6',consequence:'백이 D6으로 뻗으면 중앙 백돌 세 개를 바로 잡을 기회를 놓쳐.'}],rule:'잡는 수가 여러 곳이면 돌무리의 크기와 다음 상황을 비교하자.',question:'G8도 백돌을 잡는 데 왜 D6을 선택할까?',size:9},
 {id:'s9',title:'세 무리 이어 붙이기',goal:'흑돌 세 곳을 한 수로 연결해 봐.',black:'D5 F5 E4',white:'D4 F4 E6',focus:'검은 돌 세 무리가 분리돼 있어. 한 수를 놓았을 때 상하좌우로 닿는 흑돌 무리의 개수를 세어 봐.',best:{at:'E5',why:'E5에서 위 E4, 왼쪽 D5, 오른쪽 F5와 동시에 닿아서 세 흑돌 무리가 하나로 연결돼.'},others:[{at:'C5',why:'왼쪽 D5와는 연결되지만, E4·F5에는 닿지 않아.',white:'E5',consequence:'백이 E5에 두면 세 흑돌을 한 번에 직접 연결할 자리가 막혀.'},{at:'G5',why:'오른쪽 F5와만 연결되고 다른 두 흑돌은 분리된 채야.',white:'E5',consequence:'백이 E5를 먼저 차지하면 흑돌 사이의 연결점이 사라져.'}],rule:'한 수로 두 개 이상의 돌무리를 연결할 수 있다면 그 자리의 가치를 살펴보자.',question:'C5와 E5 중 어느 수가 더 많은 흑돌 무리를 연결해?',size:9},
 {id:'s10',title:'한 돌과 네 돌',goal:'연결된 백돌 네 개와 외딴 백돌 한 개, 어느 쪽을 잡아야 더 클까?',black:'C5 F5 C6 F6 D4 E4 D7 G3 H2 I3',white:'D5 E5 D6 E6 H3',focus:'중앙 백돌 네 개는 하나의 연결된 무리야. 오른쪽의 H3 백돌도 단수야.',best:{at:'E7',why:'E7을 막으면 중앙에 연결된 백돌 네 개가 한꺼번에 잡혀.'},others:[{at:'H4',why:'이 수로 오른쪽 백돌 H3 한 개는 잡혀. 하지만 중앙에서는 백돌 네 개를 잡을 수 있어.'},{at:'A1',why:'새 집을 벌리기보다 지금 바로 포획할 수 있는 큰 무리를 살펴봐.',white:'E7',consequence:'백이 E7으로 먼저 도망가면 흑이 한 수로 네 돌을 잡을 기회가 사라져.'}],rule:'여러 공격 중에서 지금 확실하게 얻는 효과를 비교하고 더 큰 곳을 고르자.',question:'H4도 잡는 수인데 E7이 이 문제에선 더 큰 이유는?',size:9},
 {id:'s11',title:'단수 뒤의 다음 수',goal:'지금은 아직 못 잡는 백돌 D4를 두 수에 걸쳐 잡아 봐.',black:'C4 D3 C5 D6',white:'D4',focus:'D4의 활로는 E4와 D5 두 곳이야. 한 수로 잡히지 않으니 다음 백의 응수도 예상해 봐.',best:{at:'E4',why:'E4로 단수를 걸면 백은 D5로 이어 나올 수 있어. 그 뒤 E5가 마지막 활로가 되어 흑이 다시 막으면 백 두 돌을 잡아.',white:'D5',consequence:'백이 D5로 늘어난 다음, 흑은 E5에 두어야 백돌 무리의 마지막 활로를 막을 수 있어.'},others:[{at:'D5',why:'D5를 막아도 백이 E4로 도망갈 수 있어. 이번 연습의 \'E4→백 D5→E5\' 변화도와는 다른 길이야.',white:'E4',consequence:'백이 E4로 늘면 F4·E5 등 새 활로를 만들 수 있어.'},{at:'A1',why:'백 D4가 공격받지 않은 채 남아 있어. 당장 백을 잡으려면 활로 두 곳을 살펴봐.',white:'E4',consequence:'백이 E4에 먼저 두면 새로운 활로가 늘어나 공격하기 어려워져.'}],rule:'바로 잡을 수 없다면 단수 다음에 상대가 어디로 피하는지 먼저 상상하자.',question:'E4에 둔 뒤 백이 D5에 피하면 마지막 활로는 어디야?',size:9}
];
type P={x:number;y:number};
const point=(v:string):P=>({x:v.charCodeAt(0)-65,y:Number(v.slice(1))-1});
function initialBoard(l:Lesson):BoardState{
 const b:BoardState=Array.from({length:l.size},()=>Array.from({length:l.size},()=>null));
 for(const [str,owner] of [[l.black,'black'],[l.white,'white']] as const)
   for(const t of str.split(' ')){const p=point(t);b[p.y]![p.x]=owner;}
 return b;
}
function put(b:BoardState,p:P,color:Player):{board:BoardState;captured:number}|null{
 if(!isValidMove(b,p.x,p.y,color))return null;
 const next=b.map(row=>row.slice());next[p.y]![p.x]=color;
 const captured=applyCapturesInPlace(next,p.x,p.y,color);
 return {board:next,captured:captured.length};
}
function impact(board:BoardState,at:P):string{
 const after=put(board,at,'black');
 if(!after)return '현재 이 자리에는 규칙상 돌을 둘 수 없어.';
 const group=getLiberties(after.board,at.x,at.y);
 if(after.captured>0)return '이 수를 두면 백돌 '+after.captured+'개를 실제로 잡아.';
 let adjacent=0;
 for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]])
   if(board[at.y+dy]?.[at.x+dx]==='black')adjacent++;
 if(adjacent>0)return '이 수는 기존 흑돌과 맞닿아 있어. 연결된 무리의 활로는 '+group.liberties+'곳이야.';
 return '이 수는 새 흑돌을 두는 자리야. 새 흑돌의 활로는 '+group.liberties+'곳이야.';
}
function readState():{id:string;finished:string[]}{
 try{const o=JSON.parse(localStorage.getItem('baduk-explain-practice:v1')||'{}') as {id?:unknown;finished?:unknown};
  return {id:typeof o.id==='string'&&LESSONS.some(x=>x.id===o.id)?o.id:LESSONS[5]!.id,finished:Array.isArray(o.finished)?o.finished.filter((x):x is string=>typeof x==='string'):[]};
 }catch{return {id:LESSONS[5]!.id,finished:[]};}
}
function LearnBoard({board,mark,show}: {board:BoardState;mark?:P;show?:'picked'|'correct'|'response'}){
 const n=board.length,gap=302/(n-1),r=Math.min(18,gap*.43),left=27,top=27;
 return <svg className="ex-board" viewBox="0 0 354 361" role="img" aria-label={n+'줄 바둑판 '+(show??'처음')}>
   <rect width="354" height="361" rx="13" fill="#e8c58e"/>
   {Array.from({length:n},(_,i)=><g key={i} stroke="#93754f" strokeWidth="1.2">
    <line x1={left} y1={top+i*gap} x2={left+302} y2={top+i*gap}/>
    <line x1={left+i*gap} y1={top} x2={left+i*gap} y2={top+302}/>
   </g>)}
   {Array.from({length:n},(_,i)=><g key={i} textAnchor="middle" fill="#705938" fontSize="10" fontWeight="700">
    <text x={left+i*gap} y="349">{String.fromCharCode(65+i)}</text>
    <text x="12" y={top+i*gap+4}>{i+1}</text>
   </g>)}
   {board.map((row,y)=>row.map((stone,x)=>{
    const cx=left+x*gap,cy=top+y*gap,selected=mark?.x===x&&mark.y===y;
    return <g key={x+','+y}>
     {stone&&<circle cx={cx} cy={cy} r={r} fill={stone==='black'?'#1e2924':'#f7f9f7'} stroke={stone==='black'?'#101914':'#adb1a8'} strokeWidth="1.2"/>}
     {selected&&<circle cx={cx} cy={cy} r={r+4} fill="none" stroke={show==='picked'?'#d17236':'#277852'} strokeWidth="3.5"/>}
    </g>;
   }))}
 </svg>;
}
export default function ExplainPractice(){
 const [stored]=useState(readState);
 const [id,setId]=useState(stored.id);
 const [finished,setFinished]=useState<string[]>(stored.finished);
 const [selected,setSelected]=useState<string|null>(null);
 const [showResponse,setShowResponse]=useState(false);
 const [hint,setHint]=useState(0);
 const [asked,setAsked]=useState(false);
 const current=useMemo(()=>LESSONS.find(l=>l.id===id)??LESSONS[0]!,[id]);
 const board=useMemo(()=>initialBoard(current),[current]);
 const options=[current.others[0],current.best,current.others[1]];
 const chosen=selected?options.find(c=>c.at===selected)??null:null;
 const correct=selected===current.best.at;
 const selectedAfter=chosen?put(board,point(chosen.at),'black'):null;
 const bestAfter=put(board,point(current.best.at),'black');
 const reply=chosen?.white||(!correct&&current.best.white?current.best.white:undefined);
 const afterWhite=reply&&selectedAfter?put(selectedAfter.board,point(reply),'white'):null;
 const finishWhite=correct&&current.id==='s11'&&afterWhite?put(afterWhite.board,point('E5'),'black'):null;
 useEffect(()=>{try{localStorage.setItem('baduk-explain-practice:v1',JSON.stringify({id,finished}));}catch{/* storage unavailable */}},[id,finished]);
 function open(l:Lesson){
  setId(l.id);setSelected(null);setShowResponse(false);setHint(0);setAsked(false);
 }
 function choose(c:Choice){
  setSelected(c.at);setShowResponse(false);
  if(c.at===current.best.at&&!hint&&!selected&&!finished.includes(id))setFinished(prev=>[...prev,id]);
 }
 return <section className="ex-root" aria-label="수의 이유를 이해하는 바둑 과외">
 <style>{[
  '.ex-root{padding:16px 14px 18px;border:1px solid #c8dac8;border-radius:17px;background:#fff;color:#304337;margin-bottom:15px}',
  '.ex-heading{font-size:18px;letter-spacing:-.04em;font-weight:950}.ex-intro{font-size:12px;line-height:1.65;color:#708776;margin:8px 0 10px}',
  '.ex-progress{font-size:12px;color:#447752;font-weight:850;background:#edf5ed;border-radius:9px;padding:9px 11px}',
  '.ex-pills{display:flex;flex-wrap:wrap;gap:6px;margin:11px 0}.ex-pill{border:1px solid #d7e6d5;background:#f8fbf8;color:#4f7155;border-radius:8px;padding:8px 10px;min-height:39px;font-size:11px;font-weight:800}.ex-pill[aria-pressed=true]{background:#2d6748;color:#fff;border-color:#2d6748}',
  '.ex-name{font-size:15px;font-weight:900;color:#2c593c;margin:14px 0 5px}.ex-prompt{font-size:14px;line-height:1.65;color:#365744;font-weight:800;margin:6px 0 10px}',
  '.ex-board{display:block;width:min(100%,355px);height:auto;margin:10px auto;border-radius:12px}',
  '.ex-choices{display:flex;gap:7px;flex-wrap:wrap;margin:11px 0}.ex-choice{flex:1;min-width:77px;border:1px solid #cce0ce;color:#2e6747;background:#edf6ed;border-radius:12px;padding:12px 8px;min-height:48px;font-size:14px;font-weight:900}.ex-choice[aria-pressed=true]{background:#2c674a;color:white}',
  '.ex-card{border-radius:11px;padding:12px 13px;background:#f2f7f0;color:#3e5a46;line-height:1.7;font-size:13px;margin:10px 0}.ex-card strong{color:#2c6844}.ex-error{background:#fff5e6;color:#855e37}.ex-error strong{color:#87511d}',
  '.ex-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.ex-btn{font-size:12px;font-weight:850;min-height:40px;padding:9px 11px;border:1px solid #d4e2d5;border-radius:9px;background:#fff;color:#416f4b}.ex-btn.main{color:#fff;background:#2b6647;border-color:#2b6647}',
  '.ex-subtitle{font-size:13px;font-weight:900;color:#3b6645;margin:14px 0 8px}.ex-note{font-size:11px;line-height:1.7;color:#879b8c;margin-top:9px}',
  '.ex-comparison{display:grid;grid-template-columns:1fr;gap:10px}.ex-compare{min-width:0;border:1px solid #dce6db;border-radius:10px;padding:8px;background:#fbfcf8}.ex-compare .ex-board{margin:5px auto;max-width:min(100%,310px)}.ex-compare span{font-size:12px;color:#55775d;font-weight:900;display:block;text-align:center;margin:5px 0}',
  '.ex-more{border:1px solid #e4e9df;border-radius:10px;margin:9px 0;padding:10px 12px}.ex-more summary{cursor:pointer;font-weight:850;color:#3a6649;font-size:12px}'
 ].join('')}</style>
 <div className="ex-heading">🧠 왜 여기 두고, 저기는 안 될까?</div>
 <p className="ex-intro">정답을 외우지 않고 <strong>다른 선택과 비교</strong>하면서 배우는 과외야. 먼저 바둑판을 보고 아래 세 후보 중 하나를 골라 봐. 이번 문제의 목표가 기준이야.</p>
 <div className="ex-progress">스스로 한 번에 찾은 문제 {finished.filter(x=>LESSONS.some(y=>y.id===x)).length}/{LESSONS.length} · 틀린 문제도 해설 비교 가능</div>
 <div className="ex-pills">{LESSONS.map((l,i)=><button type="button" key={l.id} className="ex-pill" aria-pressed={id===l.id} onClick={()=>open(l)}>{finished.includes(l.id)?'✓ ':''}{i+1}</button>)}</div>
 <div className="ex-name">{LESSONS.findIndex(l=>l.id===id)+1}. {current.title}</div>
 <p className="ex-prompt">{current.goal}</p>
 <LearnBoard board={board}/>
 <div className="ex-choices">{options.map((o,i)=><button key={o.at} type="button" className="ex-choice" aria-pressed={selected===o.at} onClick={()=>choose(o)}>{['①','②','③'][i]} {o.at}</button>)}</div>
 {!selected&&<div className="ex-actions">
  <button type="button" className="ex-btn" onClick={()=>setHint(h=>Math.min(2,h+1))}>💡 {hint===0?'생각할 방향만 알려줘':hint===1?'한 단계 더':'설명 다시 보기'}</button>
 </div>}
 {!selected&&hint>0&&<div className="ex-card"><strong>선생님 질문 {hint}/2</strong><br/>{hint===1?current.focus:current.question}</div>}
 {chosen&&<div role="status">
  <div className={'ex-card'+(correct?'':' ex-error')}>
   <strong>{correct?'✅ 이번 문제의 목표에 맞는 수야!':'🔎 왜 '+chosen.at+'는 목표에 덜 맞을까?'}</strong><br/>
   {correct?current.best.why:chosen.why}<br/>
   <strong style={{display:'block',marginTop:8}}>실제 판에서 확인한 효과</strong>{impact(board,point(chosen.at))}
  </div>
  {!correct&&<div className="ex-card"><strong>✅ 이 문제에서 찾으려던 자리는 {current.best.at}</strong><br/>{current.best.why}</div>}
  <div className="ex-subtitle">👀 내가 고른 수와 목표 수를 비교해 봐</div>
  <p className="ex-note">두 바둑판의 돌 모양을 천천히 비교하고, 다른 후보도 눌러 왜 덜 적합한지 확인할 수 있어.</p>
  <div className="ex-comparison">
   <div className="ex-compare"><span>내 선택 · {chosen.at}</span>{selectedAfter&&<LearnBoard board={selectedAfter.board} mark={point(chosen.at)} show="picked"/>}</div>
   <div className="ex-compare"><span>이번 목표 · {current.best.at}</span>{bestAfter&&<LearnBoard board={bestAfter.board} mark={point(current.best.at)} show="correct"/>}</div>
  </div>
  {reply&&<div className="ex-actions"><button type="button" className="ex-btn" onClick={()=>setShowResponse(x=>!x)}>{showResponse?'백 응수 감추기':'⚪ 백이 다음에 두면 어떻게 될까?'}</button></div>}
  {showResponse&&reply&&<div className="ex-card ex-error"><strong>⚪ 백 {reply}의 응수</strong><br/>{chosen.consequence??current.best.consequence??'백이 이렇게 둔다면 어떤 돌이 위험해지는지 확인해 봐.'}
   {afterWhite&&<LearnBoard board={afterWhite.board} mark={point(reply)} show="response"/>}
   {!afterWhite&&<p>이 변화는 규칙상 불가능하거나 다른 대응이 필요해. 확정적인 결과로 보지 마.</p>}
   {finishWhite&&<div style={{marginTop:12,paddingTop:9,borderTop:'1px solid #eadbc7'}}><strong>⚫ 그다음 흑 E5!</strong><br/>E5로 백돌 두 개의 마지막 활로를 막으면 실제로 {finishWhite.captured}개를 잡아. 이것까지 생각해야 '두 수 앞 수읽기'야.<LearnBoard board={finishWhite.board} mark={point('E5')} show="correct"/></div>}
  </div>}
  <div className="ex-card"><strong>📌 기억할 원칙</strong><br/>{current.rule}<br/><strong style={{display:'block',marginTop:7}}>스스로 설명해 볼 질문</strong>{current.question}</div>
  {!asked&&<button type="button" className="ex-btn" onClick={()=>setAsked(true)}>내 말로 설명했어 ✓</button>}
  {asked&&<div className="ex-note">좋아! 정답을 외우는 것보다 이유를 자기 말로 말할 수 있는지가 중요해.</div>}
  <div className="ex-actions"><button type="button" className="ex-btn" onClick={()=>{setSelected(null);setShowResponse(false);setHint(0);setAsked(false);}}>↶ 다시 생각하기</button><button type="button" className="ex-btn main" onClick={()=>open(LESSONS[(LESSONS.findIndex(l=>l.id===id)+1)%LESSONS.length]!)}>다음 상황 →</button></div>
 </div>}
 {!chosen&&<p className="ex-note">후보는 먼저 읽고 고르되, 정답을 보기 전에 ‘내 돌 살리기 / 백돌 잡기 / 연결 / 공간’ 중 어느 목적이 급한지 생각해 봐.</p>}
 <details className="ex-more"><summary>이 방식이 다른 문제와 다른 이유</summary><p style={{fontSize:12,lineHeight:1.7}}>여기서는 정답 여부보다 <strong>왜 다른 수가 이번 목표에 덜 맞는지</strong> 설명하고, 둔 뒤의 돌 모양을 직접 비교해. 고급 사활은 별도로 남겨 뒀어.</p></details>
 </section>;
}
