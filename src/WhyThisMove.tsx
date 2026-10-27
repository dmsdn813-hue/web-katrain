import { useMemo, useState } from 'react';
import {applyCapturesInPlace, getLiberties, isValidMove} from './utils/gameLogic';
import type {BoardState, CandidateMove} from './types';

type Point={x:number;y:number};
type Analysis={valid:boolean;after:BoardState;captured:number;atari:number;connected:number;rescued:number;liberties:number;neighborsBlack:number;neighborsWhite:number;location:string};
const AXIS='ABCDEFGHJKLMNOPQRST';
const pointName=(x:number,y:number,n:number)=>String(AXIS[x]??'?')+(n-y);
function examine(board:BoardState,x:number,y:number,previous?:BoardState):Analysis{
 const n=board.length;
 const invalid:Analysis={valid:false,after:board,captured:0,atari:0,connected:0,rescued:0,liberties:0,neighborsBlack:0,neighborsWhite:0,location:''};
 if(!isValidMove(board,x,y,'black',previous))return invalid;
 const beforeGroups=new Set<string>();
 const weakFriends=new Map<string,number>();
 let black=0,white=0;
 for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
   const px=x+dx,py=y+dy;if(px<0||py<0||px>=n||py>=n)continue;
   const c=board[py]?.[px];if(c==='white')white++;
   if(c==='black'){
     black++;const group=getLiberties(board,px,py);
     const id=group.group.map(a=>a.x+','+a.y).sort().join('|');
     beforeGroups.add(id);
     if(group.liberties<=2)weakFriends.set(id,group.liberties);
   }
 }
 const after=board.map(row=>row.slice());after[y]![x]='black';
 const taken=applyCapturesInPlace(after,x,y,'black');
 const own=getLiberties(after,x,y);
 let atari=0;
 const enemyGroups=new Set<string>();
 for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
   const px=x+dx,py=y+dy;if(px<0||py<0||px>=n||py>=n||after[py]?.[px]!=='white')continue;
   const g=getLiberties(after,px,py);
   const id=g.group.map(a=>a.x+','+a.y).sort().join('|');
   if(g.liberties===1&&!enemyGroups.has(id)){atari++;enemyGroups.add(id);}
 }
 const rescued=[...weakFriends.values()].filter(v=>v===1&&own.liberties>1).length;
 const edge=Math.min(x,y,n-1-x,n-1-y);
 const location=edge<=2&&((x<=2||x>=n-3)&&(y<=2||y>=n-3))?'귀':edge<=2?'변':'중앙';
 return {valid:true,after,captured:taken.length,atari,connected:beforeGroups.size,rescued,liberties:own.liberties,neighborsBlack:black,neighborsWhite:white,location};
}
function observed(a:Analysis):{title:string;intro:string;detail:string;question:string}{
 if(a.captured>0)return {title:'✅ 실제로 백돌을 잡는 수',intro:'여기에 흑돌을 놓으면 백돌 '+a.captured+'개가 즉시 잡혀.',detail:'상대 돌의 활로가 전부 없어져서 잡힌 거야. 두기 전에는 백돌 무리 전체의 빈자리를 세어 봐.',question:'이번엔 어떤 백돌이 잡히는지, 착수 전 판에서 다시 찾아봐.'};
 if(a.rescued>0)return {title:'🛡️ 잡히기 쉬운 흑돌을 구하는 수',intro:'근처에 활로가 하나뿐인 흑돌 무리가 있었어.',detail:'이 자리로 연결하거나 뻗으면 새 흑돌 무리의 활로가 '+a.liberties+'개가 돼. 돌을 잡히지 않게 지키는 효과를 확인할 수 있어.',question:'원래 흑돌 무리의 마지막 빈자리가 어디였는지 찾아봐.'};
 if(a.atari>0)return {title:'⚔️ 백돌을 단수로 몰아가는 수',intro:'여기에 두면 백돌 '+a.atari+'무리가 단수가 돼.',detail:'단수는 상대 돌무리에 활로가 하나밖에 없는 상태야. 그렇다고 반드시 다음에 잡는 건 아니고, 백이 도망가거나 반격할 수 있어.',question:'백은 어느 빈자리에 두면 살아날 수 있을까?'};
 if(a.connected>=2)return {title:'🤝 떨어져 있던 흑돌을 연결하는 수',intro:'이 자리에서 서로 다른 흑돌 '+a.connected+'무리가 하나로 이어져.',detail:'흑돌이 연결되면 활로를 함께 사용해. 하지만 연결이 항상 최선인지는 주변 백돌의 공격을 함께 봐야 해.',question:'여기에 두지 않으면 백이 어디를 끊을 수 있을까?'};
 if(a.neighborsBlack>0)return {title:'🌿 이미 둔 흑돌에서 뻗는 수',intro:'기존 흑돌 바로 옆에 두는 자리야.',detail:'이후 연결된 돌무리의 활로는 '+a.liberties+'개가 돼. 실제로 안전한지 알려면 주변 백돌이 어떻게 대응하는지도 봐야 해.',question:'백돌이 다음에 어디로 다가오면 불편할지 생각해 봐.'};
 if(a.neighborsWhite>0)return {title:'⚔️ 백돌 가까이에 두는 수',intro:'백돌과 바로 맞닿아서 싸움을 시작하는 자리야.',detail:'현재 착수만으로 백돌이 바로 잡히거나 단수가 되는지는 확인되지 않았어. 더 멀리 내다본 결과가 이유일 수 있어.',question:'백이 이 자리 바로 옆에 두면 흑돌이 안전할까?'};
 return {title:a.location==='귀'?'🏠 귀 쪽에 새롭게 두는 수':a.location==='변'?'🏠 변 쪽에 새롭게 두는 수':'🌐 중앙 쪽에 새롭게 두는 수',intro:'이 자리는 바둑판의 '+a.location+' 쪽이고, 지금 주변에 직접 맞닿은 돌은 없어.',detail:'귀는 집을 만들기 유리한 경우가 많고, 변은 영역을 넓히거나 연결할 때 이용해. 중앙은 여러 방향에 영향을 줄 수 있어. 다만 실제로 KataGo가 이 수를 가장 좋게 본 전략적 이유를 이 정보만으로 확정할 수는 없어.',question:'여기서 두 칸 떨어진 곳에 백이 다가와도 돌을 이어갈 수 있을까?'};
}
function SmallBoard({board,move,showAfter}: {board:BoardState;move:Point;showAfter:boolean}){
 const n=board.length,span=Math.min(7,n),startX=Math.max(0,Math.min(n-span,move.x-Math.floor(span/2))),startY=Math.max(0,Math.min(n-span,move.y-Math.floor(span/2)));
 const gap=240/(span-1),r=Math.min(20,gap*.42),x0=24,y0=23;
 return <svg className="wm-board" viewBox="0 0 289 290" role="img" aria-label={showAfter?'추천 자리에 착수한 후 주변 돌 모양':'추천 자리에 착수하기 전 주변 돌 모양'}>
  <rect width="289" height="290" rx="11" fill="#e8c893"/>
  {Array.from({length:span},(_,i)=><g key={'g'+i} stroke="#937147" strokeWidth="1.15"><line x1={x0} x2={x0+240} y1={y0+i*gap} y2={y0+i*gap}/><line x1={x0+i*gap} x2={x0+i*gap} y1={y0} y2={y0+240}/></g>)}
  {Array.from({length:span*span},(_,i)=>{
   const x=startX+i%span,y=startY+Math.floor(i/span),stone=board[y]?.[x],cx=x0+(x-startX)*gap,cy=y0+(y-startY)*gap,chosen=x===move.x&&y===move.y;
   return <g key={i}>
    {stone&&<circle cx={cx} cy={cy} r={r} fill={stone==='black'?'#232a25':'#fff'} stroke={stone==='black'?'#181e1a':'#a6a9a2'} strokeWidth="1"/>}
    {chosen&&<circle cx={cx} cy={cy} r={r+3} fill="none" stroke="#d56b2c" strokeWidth="3.2"/>}
    {chosen&&!showAfter&&<text x={cx} y={cy+5} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#8d5321">?</text>}
   </g>;
  })}
  <text x="144" y="281" textAnchor="middle" fontSize="10" fill="#886737">{showAfter?'● 착수한 뒤의 변화':'? 착수하기 전의 판'}</text>
 </svg>;
}
export default function WhyThisMove({board,previous,candidate,rank}:{board:BoardState;previous?:BoardState;candidate:CandidateMove;rank:number}){
 const [revealed,setRevealed]=useState(false);
 const [after,setAfter]=useState(false);
 const analysis=useMemo(()=>examine(board,candidate.x,candidate.y,previous),[board,previous,candidate.x,candidate.y]);
 const why=observed(analysis);
 return <div className="wm-box">
  <style>{[
   '.wm-box{background:#f8fbf6;border:1px solid #cbdccb;border-radius:12px;margin:12px 0 4px;padding:13px 12px;color:#385743}',
   '.wm-title{font-size:14px;font-weight:950;color:#28533c}.wm-lead{font-size:12px;line-height:1.65;color:#617a65;margin:7px 0 9px}',
   '.wm-question{font-size:12px;background:#eaf3e8;color:#406b4c;padding:9px 11px;border-radius:9px;line-height:1.65;margin:8px 0}',
   '.wm-button{border-radius:9px;background:#2e6548;border:1px solid #2e6548;color:white;padding:9px 12px;font-size:12px;min-height:40px;font-weight:850}',
   '.wm-buttons{display:flex;gap:6px;flex-wrap:wrap}.wm-button.light{background:white;color:#416e51;border-color:#cdddcb}',
   '.wm-answer{background:white;border:1px solid #dce7d9;border-radius:9px;padding:12px 11px;margin-top:10px}.wm-answer strong{font-size:13px;color:#2a603f}.wm-answer p{font-size:12px;line-height:1.7;color:#4c6854;margin:7px 0}',
   '.wm-board{display:block;width:min(100%,267px);height:auto;margin:8px auto 10px}',
   '.wm-warning{font-size:11px;color:#899b8d;line-height:1.6;margin:10px 0 0}'
  ].join('')}</style>
  <div className="wm-title">🔍 왜 {pointName(candidate.x,candidate.y,board.length)}에 둬야 할까?</div>
  <p className="wm-lead">{rank}순위 후보야. 먼저 답을 읽지 말고 이 자리에 흑돌을 두면 무엇이 달라질지 5초만 생각해 봐.</p>
  <div className="wm-question">① 내 돌이 위험한가? ② 백돌을 잡거나 공격할 수 있나? ③ 돌을 연결할 수 있나? ④ 아니면 새 공간을 차지하는 자리인가?</div>
  <div className="wm-buttons"><button type="button" className="wm-button" onClick={()=>{setRevealed(v=>!v);setAfter(false);}}>{revealed?'설명 가리기':'이 자리의 이유 알아보기'}</button></div>
  {revealed&&(analysis.valid?<div className="wm-answer">
   <strong>{why.title}</strong><p>{why.intro}</p><p>{why.detail}</p>
   <p><strong>📌 다시 생각할 질문</strong><br/>{why.question}</p>
   <div className="wm-buttons"><button type="button" className="wm-button light" onClick={()=>setAfter(a=>!a)}>{after?'놓기 전 보기':'놓은 뒤 확인하기'} ↔</button></div>
   <SmallBoard board={after?analysis.after:board} move={{x:candidate.x,y:candidate.y}} showAfter={after}/>
  </div>:<p className="wm-warning">지금 이 자리는 이미 돌이 있거나 둘 수 없는 자리야. 분석이 바뀌었을 수 있으니 다음 차례에 다시 확인해 봐.</p>)}
  <p className="wm-warning">※ 위 설명은 현재 돌의 활로·포획·연결로 직접 확인한 효과야. KataGo가 이 수를 선택한 모든 전략적 이유를 증명하는 해설은 아니야. 그리고 추천 후보는 모델 성능과 탐색량에 따라 달라질 수 있어.</p>
 </div>;
}
