import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import AdvancedLessons from './AdvancedLessons';
import ProTsumego from './ProTsumego';
import WhyThisMove from './WhyThisMove';
import {restoreCoachGame, startCoachAutosave} from './coachAutosave';
import { useGameStore } from './store/gameStore';
import { getLiberties, isValidMove } from './utils/gameLogic';
import { generateSgfFromTree, parseSgf } from './utils/sgf';
import { KATAGO_RECOMMENDED_MODEL_URL, KATAGO_SMALL_MODEL_PATH, isSmallKataGoModel } from './engine/katago/modelDefaults';
import { publicUrl } from './utils/publicUrl';
import type { BoardState, CandidateMove, GameNode, Move } from './types';

type SavedGame = {id:string;date:string;result:string;moves:number;sgf:string};

// 용어를 몰라도 바로 배울 수 있도록, 설명을 짧고 구체적으로 유지한다.
const GO_TERMS = {
  '귀': '바둑판의 네 모서리 근처야. 적은 돌로 빈 공간을 둘러싸기 쉬워서 초반에 자주 둬.',
  '변': '바둑판 네 가장자리야. 모서리와 가운데 사이에서 공간을 넓혀 가는 곳이야.',
  '중앙': '바둑판 한가운데 쪽이야. 여러 방향으로 뻗기 좋지만, 돌 한 개만으로 내 집이 되지는 않아.',
  '활로': '내 돌 바로 위·아래·왼쪽·오른쪽의 빈 교차점이야. 같은 색 돌이 이어져 있으면 빈 점을 함께 사용해.',
  '단수': '돌이나 연결된 돌무리의 활로가 딱 한 개 남은 상태야. 상대가 그 빈 점을 막으면 잡힐 수 있어.',
  '집': '상대가 들어와 차지하기 어려운, 내 돌로 둘러싼 빈 공간이야. 바둑은 돌 개수보다 집과 영역이 중요해.',
  '두 눈': '내 돌무리 안에 따로 떨어진 빈 공간 두 개가 있는 모양이야. 제대로 된 두 눈이 있으면 보통 잡히지 않아.',
  '패스': '이번 차례에 돌을 놓지 않고 상대에게 넘기는 거야. 양쪽이 연속으로 패스하면 대국이 끝나.',
} as const;
type GoTerm = keyof typeof GO_TERMS;
const BASIC_MODEL_URL = publicUrl(KATAGO_SMALL_MODEL_PATH);
function readSavedGames():SavedGame[]{
  try {const raw=JSON.parse(window.localStorage.getItem('my-go-coach:completed-games')||'[]');
  if(!Array.isArray(raw))return [];
  return raw.filter((o:unknown):o is SavedGame=>!!o&&typeof o==='object'&&typeof (o as SavedGame).sgf==='string'&&typeof (o as SavedGame).id==='string').slice(0,12);
  }catch{return [];}
}

/** 바둑 한 수 — iPhone/Safari 한글 전용 홈. Web KaTrain의 실제 엔진/합법착수/기보를 그대로 사용한다. */
const AXIS = 'ABCDEFGHJKLMNOPQRST';
const spot = (x: number, y: number, n = 9) => x < 0 || y < 0 ? '패스' : `${AXIS[x] ?? '?'}${n - y}`;
const lastOf = (node: GameNode, color: 'black' | 'white'): GameNode | null => {
  for (let p: GameNode | null = node; p; p = p.parent) if (p.move?.player === color) return p;
  return null;
};
const sorted = (node: GameNode | null): CandidateMove[] =>
  (node?.analysis?.moves ?? []).slice().sort((a, b) => a.order - b.order);
const isPass = (m?: Move | null) => !!m && (m.x < 0 || m.y < 0);

function scoreChinese(board: BoardState, komi: number) {
  const n = board.length;
  let black = 0, white = komi, neutral = 0;
  const visited = new Set<number>();
  const around = (x: number, y: number): [number, number][] => [[x - 1,y],[x + 1,y],[x,y - 1],[x,y + 1]].filter(([a,b])=>a >= 0 && b >= 0 && a < n && b < n) as [number,number][];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const stone = board[y]?.[x];
    if (stone === 'black') { black++; continue; }
    if (stone === 'white') { white++; continue; }
    const id = y*n+x;
    if (visited.has(id)) continue;
    const queue: [number,number][] = [[x,y]];
    visited.add(id);
    const colors = new Set<string>();
    for (let j = 0; j < queue.length; j++) {
      const [cx,cy] = queue[j];
      for (const [nx,ny] of around(cx,cy)) {
        const s = board[ny]?.[nx];
        if (s) colors.add(s);
        else if (!visited.has(ny*n+nx)) { visited.add(ny*n+nx); queue.push([nx,ny]); }
      }
    }
    if (colors.size === 1 && colors.has('black')) black += queue.length;
    else if (colors.size === 1 && colors.has('white')) white += queue.length;
    else neutral += queue.length;
  }
  return {black,white,neutral,winner:black>white?'흑':white>black?'백':'무승부',margin:Math.abs(black-white)};
}

/**
 * 초보 학습 대국의 조기 판정. 정식 바둑은 포획 수만으로 끝나지 않지만,
 * 압도적인 포획 차에서도 AI가 끝없이 악수를 반복하지 않도록 연습 규칙을 둔다.
 * 기준을 충분히 높여 정상적인 접전은 패스/기권/계가로 마무리한다.
 */
function overwhelmingPracticeWinner(board: BoardState, turns: number, blackCaptures: number, whiteCaptures: number): 'black'|'white'|null {
  const n = board.length;
  const capturesNeeded = n === 9 ? 30 : n === 13 ? 75 : 155;
  const turnsNeeded = n === 9 ? 28 : n === 13 ? 60 : 120;
  if (turns < turnsNeeded) return null;
  const captureLead = blackCaptures - whiteCaptures;
  if (captureLead >= capturesNeeded) return 'black';
  if (captureLead <= -capturesNeeded) return 'white';
  return null;
}

function moveExplanation(option: CandidateMove, board: BoardState) {
  if (option.x < 0 || option.y < 0) return '계속 두는 것보다 패스를 고려하는 자리야.';
  const n = board.length;
  let friends = 0, enemies = 0;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x = option.x+dx,y = option.y+dy;
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    if (board[y]?.[x] === 'black') friends++;
    if (board[y]?.[x] === 'white') enemies++;
  }
  if (friends && enemies) return '우리 돌과 상대 돌 사이의 급소야. 끊김과 연결에 주목해 봐.';
  if (enemies) return '백돌 근처의 싸움 자리야. 주변 돌의 활로를 확인하자.';
  if (friends >= 2) return '흑돌 연결과 모양 보강에 도움이 될 가능성이 있어.';
  if (friends) return '흑돌을 뻗어서 활동 범위를 넓히는 방향이야.';
  const edge = Math.min(option.x,option.y,n-1-option.x,n-1-option.y);
  return edge <= 2 ? '귀와 변에서 효율적으로 공간을 확보하는 방향이야.' : '중앙의 영향력을 노리는 수야. 바로 집이 되지는 않아.';
}

function explain(blackNode: GameNode | null) {
  if (!blackNode?.move) return {
    title: '첫 수를 놓아 봐!',
    detail: '바둑판을 터치해 첫 수를 둬 봐. 돌의 안전과 더 좋은 자리를 하나씩 알려 줄게.',
    facts: [] as string[],
    loss: null as number | null,
  };

  const move = blackNode.move;
  if (isPass(move)) return {
    title: '이번에는 패스했어',
    detail: '패스는 더 둘 곳이 없다고 판단했을 때 사용하는 수야. 약한 돌이나 빈 집이 남았는지 확인해 보자.',
    facts: [] as string[],
    loss: null as number | null,
  };

  const parent = blackNode.parent;
  const board = blackNode.gameState.board;
  const before = parent?.gameState.board ?? board;
  const options = sorted(parent);
  const best = options[0];
  const actual = options.find(c => c.x === move.x && c.y === move.y);
  let loss: number | null = null;
  if (actual && best) {
    if (typeof actual.relativePointsLost === 'number' && Number.isFinite(actual.relativePointsLost)) {
      loss = Math.max(0, actual.relativePointsLost);
    } else if (Number.isFinite(actual.scoreLead) && Number.isFinite(best.scoreLead)) {
      loss = Math.max(0, best.scoreLead - actual.scoreLead);
    }
  }

  // 숫자만으로 수의 가치를 알려주지 않는다. 눈에 보이는 돌의 위험을 먼저 설명한다.
  const facts: string[] = [];
  const taken = blackNode.gameState.capturedWhite - (parent?.gameState.capturedWhite ?? 0);
  if (taken > 0) facts.push(`백돌 ${taken}개를 잡았어! 다만 내 돌도 안전한지 이어서 확인해 보자.`);

  let urgent = false;
  const own = board[move.y]?.[move.x];
  if (own === 'black') {
    const group = getLiberties(board, move.x, move.y);
    if (group.liberties === 1) {
      facts.push('🚨 단수야! 방금 둔 흑돌은 백이 한 번 더 막으면 잡힐 수 있어. 다음 수에서는 활로부터 늘리자.');
      urgent = true;
    } else if (group.liberties === 2) {
      facts.push('이 흑돌은 빠져나갈 빈 점이 두 곳뿐이야. 백이 가까이 오면 돌을 연결하거나 도망갈 방법부터 찾아봐.');
    } else {
      facts.push('지금 둔 흑돌은 바로 잡히지는 않아. 다음에는 주변 백돌이 어디를 공격할 수 있는지 보자.');
    }
  }

  // 이번 수로 주변 백돌을 단수에 몰았는지 검사한다.
  const checked = new Set<string>();
  let atariWhite = false;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x = move.x + dx, y = move.y + dy;
    if (x < 0 || y < 0 || x >= board.length || y >= board.length) continue;
    if (board[y]?.[x] !== 'white' || checked.has(`${x},${y}`)) continue;
    const group = getLiberties(board,x,y);
    for (const stone of group.group) checked.add(`${stone.x},${stone.y}`);
    if (group.liberties === 1) atariWhite = true;
  }
  if (atariWhite) facts.push('백돌을 단수에 몰았어! 다음에 어느 곳으로 도망갈 수 있을지 살펴보자.');

  const edge = Math.min(move.x,move.y,board.length-1-move.x,board.length-1-move.y);
  if (!urgent && !atariWhite) {
    facts.push(edge <= 2
      ? '귀나 변을 활용한 수야. 집을 넓히면서 돌이 서로 끊기지 않는지도 확인해 봐.'
      : '중앙에 영향력을 만들었어. 하지만 중앙에 둔 돌이 바로 집이 되는 건 아니야.');
  }

  const alternative = best && (best.x !== move.x || best.y !== move.y);
  const whyAlternative = alternative
    ? `대신 ${spot(best!.x,best!.y,board.length)}를 생각해 봐. ${moveExplanation(best!,before)}`
    : '';
  if (loss === null) {
    return {
      title: '이번 수를 함께 살펴보자',
      detail: alternative
        ? `이 수의 정확한 평가는 아직 준비되지 않았어. ${whyAlternative}`
        : '이번 수의 정확한 평가는 아직 계산 중이야. 주변 돌의 활로와 연결부터 살펴보자.',
      facts,
      loss,
    };
  }

  if (loss <= 0.7) return {
    title: '🌟 좋은 수야!',
    detail: atariWhite
      ? 'KataGo도 좋게 보는 수야. 백돌을 압박하면서 먼저 주도권을 잡으려는 의미가 있어.'
      : '괜찮은 선택이야. 당장 잡힐 위험이 있는 돌이 없다면, 이번 수와 연결되는 다음 수를 생각해 봐.',
    facts,
    loss,
  };
  if (loss <= 2.5) return {
    title: '🙂 괜찮은 수야',
    detail: `큰 실수는 아니야! ${whyAlternative || '다음에는 내 돌이 끊기는 곳부터 살펴보자.'}`,
    facts,
    loss,
  };
  if (loss <= 5) return {
    title: '🔎 더 좋은 선택이 있어',
    detail: `이번 수를 두기 전에 더 급한 자리가 있었어. ${whyAlternative || '약한 흑돌부터 살려야 하는지 확인해 보자.'}`,
    facts,
    loss,
  };
  return {
    title: '⚠️ 중요한 기회를 놓쳤어',
    detail: urgent
      ? `지금은 내 돌의 안전을 먼저 해결하는 게 중요해. ${whyAlternative}`
      : `이번 수보다는 다른 곳을 먼저 두는 게 좋겠어. ${whyAlternative || '내 돌이 잡힐 위험부터 확인하자.'}`,
    facts,
    loss,
  };
}

// 설명과 복기는 서버에 보내지 않고 이 브라우저 안에서 처리한다.
type CoachTab = 'play'|'review'|'learn';
type Point = {x:number;y:number};
type LessonKind = 'corner'|'liberty'|'capture';
const LESSONS: {kind:LessonKind;title:string;question:string;stones:{x:number;y:number;player:'black'|'white'}[];answer:Point;explanation:string}[] = [
  {kind:'corner',title:'귀 찾기',question:'5줄 연습판의 네 모서리 점 중 하나를 눌러 봐.',stones:[],answer:{x:0,y:0},explanation:'맞아! 네 모서리 근처를 귀라고 해. 처음엔 귀를 이용하면 적은 돌로 집을 만들기 쉬워.'},
  {kind:'liberty',title:'활로 찾기',question:'흑돌이 숨 쉴 수 있는 빈자리를 찾아봐.',stones:[{x:2,y:2,player:'black'},{x:2,y:1,player:'white'},{x:1,y:2,player:'white'},{x:3,y:2,player:'white'}],answer:{x:2,y:3},explanation:'맞아! 흑돌은 아래쪽 한 곳만 비어 있어. 이런 상태를 단수라고 해.'},
  {kind:'capture',title:'백돌 잡기',question:'흑돌을 어디에 놓아야 가운데 백돌을 잡을까?',stones:[{x:2,y:2,player:'white'},{x:2,y:1,player:'black'},{x:1,y:2,player:'black'},{x:3,y:2,player:'black'}],answer:{x:2,y:3},explanation:'좋아! 마지막 빈자리를 막으면 가운데 백돌을 잡을 수 있어.'},
];
function TeachingBoard({stones,marker,onPoint,selected}: {stones:{x:number;y:number;player:'black'|'white'}[];marker?:Point|null;onPoint?:(x:number,y:number)=>void;selected?:Point|null}) {
  return <svg className="ew-teachingboard" viewBox="0 0 222 222" role="group" aria-label="바둑 용어와 착수를 배우는 5줄 연습판">
    <rect width="222" height="222" fill="#ecd2a4" rx="13"/>
    {Array.from({length:5},(_,i)=><g key={i} stroke="#94744b" strokeWidth="1.3"><line x1="33" x2="189" y1={33+i*39} y2={33+i*39}/><line x1={33+i*39} x2={33+i*39} y1="33" y2="189"/></g>)}
    {Array.from({length:25},(_,i)=>{const x=i%5,y=Math.floor(i/5),c=stones.find(p=>p.x===x&&p.y===y);const chosen=selected?.x===x&&selected?.y===y;return <g key={i}>
      {marker?.x===x&&marker?.y===y&&<circle cx={33+x*39} cy={33+y*39} r="15" stroke="#e7a32b" strokeWidth="3" fill="#fae9aa"/>}
      {c&&<circle cx={33+x*39} cy={33+y*39} r="16" fill={c.player==='black'?'#232b27':'#fafafa'} stroke="#92958d" strokeWidth="1.1"/>}
      {chosen&&<circle cx={33+x*39} cy={33+y*39} r="18" fill="none" stroke="#23754c" strokeWidth="3.5"/>}
      {onPoint&&!c&&<circle role="button" tabIndex={0} aria-label={`${x+1}열 ${y+1}행 선택`} cx={33+x*39} cy={33+y*39} r="18" fill="transparent" onClick={()=>onPoint(x,y)} onKeyDown={(e:{key:string;preventDefault:()=>void})=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPoint(x,y);}}}/>}
    </g>;})}
  </svg>;
}
function termExample(term:GoTerm):{stones:{x:number;y:number;player:'black'|'white'}[];marker:Point|null;caption:string}{
  const black=(x:number,y:number)=>({x,y,player:'black' as const});
  const white=(x:number,y:number)=>({x,y,player:'white' as const});
  if(term==='귀')return {stones:[black(0,0)],marker:{x:0,y:0},caption:'노란 자리는 판의 모서리야. 네 곳 모두 귀라고 불러.'};
  if(term==='변')return {stones:[black(2,0)],marker:{x:2,y:0},caption:'노란 자리는 가장자리인 변에 있어.'};
  if(term==='중앙')return {stones:[black(2,2)],marker:{x:2,y:2},caption:'노란 자리는 판의 가운데에 가까운 곳이야.'};
  if(term==='활로'||term==='단수')return {stones:[black(2,2),white(2,1),white(1,2),white(3,2)],marker:{x:2,y:3},caption:'흑돌 바로 아래의 빈 점이 유일한 활로야. 하나뿐이라 단수 상태야.'};
  if(term==='집')return {stones:[black(1,2),black(2,1),black(3,2),black(2,3)],marker:{x:2,y:2},caption:'흑돌이 둘러싼 가운데 빈 점이 집의 간단한 예야. 실제 집은 더 복잡할 수 있어.'};
  if(term==='두 눈')return {stones:[black(0,0),black(1,0),black(2,0),black(3,0),black(4,0),black(0,1),black(2,1),black(4,1),black(0,2),black(1,2),black(2,2),black(3,2),black(4,2)],marker:{x:1,y:1},caption:'이 그림의 빈 점 두 개는 눈을 이해하기 위한 간단한 예야. 실제 살아 있는 모양은 주위 돌까지 봐야 해.'};
  return {stones:[],marker:null,caption:'패스는 돌을 두지 않고 차례를 넘기는 행동이야.'};
}
function weakBlackGroup(b:BoardState):{stones:Point[];liberties:Point[]}|null{
  const n=b.length,seen=new Set<string>();
  let best:{stones:Point[];liberties:Point[]}|null=null;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    if(b[y]?.[x]!=='black'||seen.has(`${x},${y}`))continue;
    const info=getLiberties(b,x,y);const lib=new Map<string,Point>();
    for(const st of info.group){seen.add(`${st.x},${st.y}`);for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const nx=st.x+dx,ny=st.y+dy;
      if(nx>=0&&ny>=0&&nx<n&&ny<n&&!b[ny]?.[nx])lib.set(`${nx},${ny}`,{x:nx,y:ny});
    }}
    const current={stones:info.group,liberties:[...lib.values()]};
    if(current.liberties.length<=2&&(!best||current.liberties.length<best.liberties.length))best=current;
  }
  return best;
}
function currentPath(node:GameNode):GameNode[]{const path:GameNode[]=[];for(let p:GameNode|null=node;p;p=p.parent)path.unshift(p);return path;}
// 저장된 SGF는 현재 대국을 바꾸지 않고 별도의 읽기 전용 기보로 복원한다.
function savedReplay(sgf:string):GameNode[]{
  const data=parseSgf(sgf);const n=data.initialBoard.length;
  let prev:GameNode={id:'review-root',parent:null,children:[],move:null,analysis:null,gameState:{board:data.initialBoard.map(row=>row.slice()),currentPlayer:data.moves[0]?.player??'black',moveHistory:[],capturedBlack:0,capturedWhite:0,komi:data.komi}};
  const frames=[prev];let blackTaken=0,whiteTaken=0;
  for(const [i,m] of data.moves.entries()){
    const next=prev.gameState.board.map(row=>row.slice());
    if(m.x>=0&&m.y>=0&&m.x<n&&m.y<n){
      next[m.y]![m.x]=m.player;
      const opponent=m.player==='black'?'white':'black';
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const x=m.x+dx,y=m.y+dy;
        if(x<0||y<0||x>=n||y>=n||next[y]?.[x]!==opponent)continue;
        const info=getLiberties(next,x,y);
        if(info.liberties===0){for(const p of info.group)next[p.y]![p.x]=null;if(opponent==='white')whiteTaken+=info.group.length;else blackTaken+=info.group.length;}
      }
    }
    const node:GameNode={id:`review-${i}`,parent:prev,children:[],move:m,analysis:null,gameState:{board:next,currentPlayer:m.player==='black'?'white':'black',moveHistory:[...prev.gameState.moveHistory,m],capturedBlack:blackTaken,capturedWhite:whiteTaken,komi:data.komi}};
    prev.children.push(node);frames.push(node);prev=node;
  }
  return frames;
}
type ReviewMoment={index:number;label:string;detail:string};
function reviewMoments(frames:GameNode[]):ReviewMoment[]{
  const hits:ReviewMoment[]=[];
  for(let i=1;i<frames.length;i++){
    const node=frames[i]!,p=frames[i-1]!,m=node.move;if(!m)continue;
    const tookWhite=node.gameState.capturedWhite-p.gameState.capturedWhite;
    const tookBlack=node.gameState.capturedBlack-p.gameState.capturedBlack;
    if(tookWhite>0||tookBlack>0)hits.push({index:i,label:`${i}수 · 돌 잡기`,detail:`${m.player==='black'?'흑':'백'}이 ${tookWhite+tookBlack}개를 잡은 장면이야.`});
    if(m.player==='black'&&m.x>=0&&node.gameState.board[m.y]?.[m.x]==='black'&&getLiberties(node.gameState.board,m.x,m.y).liberties===1)hits.push({index:i,label:`${i}수 · 내 돌이 위험`,detail:'이 장면에서 방금 둔 흑돌 무리의 빈자리가 하나뿐이야.'});
    if(isPass(m))hits.push({index:i,label:`${i}수 · 패스`,detail:`${m.player==='black'?'흑':'백'}이 차례를 넘겼어. 끝난 게임인지는 다음 수까지 확인해 봐.`});
  }
  // 정확히 확인된 장면만 내세우며, 찾지 못하면 기보의 주요 시점을 제공한다.
  if(hits.length===0&&frames.length>1){
    const indices=[1,Math.max(1,Math.floor((frames.length-1)/2)),frames.length-1];
    return [...new Set(indices)].map(index=>({index,label:`${index}수 · 돌아보기`,detail:'이때 흑돌이 안전했는지, 주변에 빈자리가 얼마나 있었는지 살펴봐.'}));
  }
  return hits.slice(0,8);
}
function summarizeReview(frames:GameNode[]):{good:string;caution:string;goal:string}{
  const last=frames[frames.length-1];
  if(!last||frames.length===1)return {good:'아직 둔 수가 없어. 첫 수부터 천천히 시작해 보자.',caution:'착수 전이라 평가할 수 없어.',goal:'첫 수를 놓기 전에 귀·변·가운데를 구분해 보자.'};
  const taken=last.gameState.capturedWhite;
  let atari: number|null=null;
  let lost: number|null=null;
  for(let i=1;i<frames.length;i++){
    const m=frames[i]?.move,node=frames[i],prev=frames[i-1];
    if(!m||!node||!prev||m.player!=='black'||m.x<0||m.y<0)continue;
    if(atari===null&&node.gameState.board[m.y]?.[m.x]==='black'&&getLiberties(node.gameState.board,m.x,m.y).liberties===1)atari=i;
    const choices=sorted(prev);const best=choices[0],actual=choices.find(a=>a.x===m.x&&a.y===m.y);
    if(best&&actual&&typeof actual.relativePointsLost==='number'&&actual.relativePointsLost>=3&&lost===null)lost=i;
  }
  return {
    good:taken>0?`흑이 백돌을 총 ${taken}개 잡았어. 어떤 모양에서 잡았는지 주요 장면을 다시 봐 보자.`:`흑이 직접 ${frames.filter(f=>f.move?.player==='black').length}번의 수를 선택했어. 잘 잡은 돌은 없더라도 연결과 빈자리를 살펴보는 연습을 했어.`,
    caution:atari!==null?`${atari}수에서 흑돌이 단수가 됐어. 그때 어디가 마지막 빈자리인지 확인해 보자.`:lost!==null?`${lost}수에는 분석상 더 나은 후보가 있었어. 어떤 돌이 위험했는지 다시 살펴봐.`:'기록만으로 뚜렷한 실수 원인을 단정하기 어려워. 대국의 주요 장면에서 돌의 안전을 하나씩 확인해 보자.',
    goal:atari!==null?'상대가 내 돌을 둘러싸기 시작하면 집보다 활로를 먼저 확인하기.':lost!==null?'돌을 놓기 전에 꼭 다른 후보 한 곳도 생각해 보기.':'다음 판에는 매 수마다 내 돌이 끊기는지 확인해 보기.',
  };
}
function partOfBoard(x:number,y:number,n:number):string{
  const edge=Math.min(x,y,n-1-x,n-1-y);
  if(edge<=2&&((x<=2||x>=n-3)&&(y<=2||y>=n-3)))return '모서리 쪽';
  if(edge<=2)return '가장자리 쪽';
  return '가운데 쪽';
}

function StatusDot({status}:{status:string}) {
  const label = status==='ready'?'KataGo 연결됨':status==='error'?'엔진 오류':status==='loading'?'모델 로딩 중':'KataGo 준비 중';
  return <span className={`ew-status ew-${status}`}><span className="ew-led"/>{label}</span>;
}

function App() {
  const currentNode=useGameStore(s=>s.currentNode);
  const board=useGameStore(s=>s.board);
  const currentPlayer=useGameStore(s=>s.currentPlayer);
  const moveHistory=useGameStore(s=>s.moveHistory);
  const capturedWhite=useGameStore(s=>s.capturedWhite);
  const capturedBlack=useGameStore(s=>s.capturedBlack);
  const isAiThinking=useGameStore(s=>s.isAiThinking);
  const engineStatus=useGameStore(s=>s.engineStatus);
  const engineError=useGameStore(s=>s.engineError);
  const engineModelName=useGameStore(s=>s.engineModelName);
  const treeVersion=useGameStore(s=>s.treeVersion);
  const settings=useGameStore(s=>s.settings);
  const notification=useGameStore(s=>s.notification);
  const isAnalysisMode=useGameStore(s=>s.isAnalysisMode);
  const [level,setLevel]=useState<18|12|7>(12);
  const [activeTab,setActiveTab]=useState<CoachTab>('play');
  const [reviewFrames,setReviewFrames]=useState<GameNode[]>([]);
  const [reviewIndex,setReviewIndex]=useState(0);
  const [reviewLabel,setReviewLabel]=useState('현재 대국');
  const [reviewPractice,setReviewPractice]=useState(false);
  const [reviewGuess,setReviewGuess]=useState<Point|null>(null);
  const [hintStep,setHintStep]=useState(0);
  const [showHintPanel,setShowHintPanel]=useState(false);
  const [overlayMode,setOverlayMode]=useState<'none'|'danger'|'liberty'|'recommend'>('none');
  const [extraCoaching,setExtraCoaching]=useState(false);
  const [lessonIndex,setLessonIndex]=useState(0);
  const [lessonGuess,setLessonGuess]=useState<Point|null>(null);
  const [dailyDone,setDailyDone]=useState<number[]>(()=>{
    try{const key='baduk-seven-lessons-'+new Date().toLocaleDateString('sv-SE');return JSON.parse(window.localStorage.getItem(key)||'[]') as number[];}catch{return [];}
  });
  const [note,setNote]=useState('');
  const [autosaveState,setAutosaveState]=useState<'starting'|'saved'|'error'>('starting');
  const [resumeMessage,setResumeMessage]=useState('');
  const [askText,setAskText]=useState('');
  const [askAnswer,setAskAnswer]=useState('');
  const [savedGames,setSavedGames]=useState<SavedGame[]>(()=>readSavedGames());
  const recorded=useRef(new Set<string>());
  const [showSuggestions,setShowSuggestions]=useState(false);
  const [highlight,setHighlight]=useState<string|null>(null);
  const [showReview,setShowReview]=useState(false);
  const [confirmNew,setConfirmNew]=useState(false);
  const [busyMove,setBusyMove]=useState(false);
  const [showBoardSizes,setShowBoardSizes]=useState(false);
  const [selectedTerm,setSelectedTerm]=useState<GoTerm>('귀');
  const failedModelRecovery=useRef<string|null>(null);
  const [boardZoomed,setBoardZoomed]=useState(()=>typeof window!=='undefined'&&window.innerWidth<640&&useGameStore.getState().board.length===19);
  const requestKeys=useRef(new Set<string>());
  const initialized=useRef(false);

  useEffect(()=>{
    if(!initialized.current){
    initialized.current=true;
    document.title='바둑 한 수 · KataGo 과외';
    document.documentElement.lang='ko';
    const s=useGameStore.getState();
    s.updateSettings({appLocale:'ko',defaultBoardSize:s.board.length===13||s.board.length===19?s.board.length:9,showCoordinates:true,aiStrategy:'rank',aiRankKyu:12,katagoVisits:180,katagoMaxTimeMs:6500,analysisExperience:'coach'});
    if (![9,13,19].includes(s.board.length)) s.startNewGame({boardSize:9,komi:6.5,rules:'chinese',handicap:0});
    const updated=useGameStore.getState();
    if(updated.isAiPlaying && updated.aiColor)updated.toggleAi(updated.aiColor);
    if(!useGameStore.getState().isAnalysisMode) useGameStore.getState().toggleAnalysisMode();
    const recovered=restoreCoachGame();
    if(recovered.status==='restored'){
      setResumeMessage('💚 '+recovered.message+' 이 대국부터 계속 둘 수 있어!');
      const loaded=useGameStore.getState();
      setBoardZoomed(window.innerWidth<640&&loaded.board.length===19);
    }else if(recovered.status==='error'){
      setResumeMessage('⚠️ '+recovered.message);
    }
  }
  // Autosave is re-subscribed on StrictMode remounts, without reloading twice.
  return startCoachAutosave((ok)=>setAutosaveState(ok?'saved':'error'));
  },[]);

  // 흑이 생각하는 동안 다음 착수를 미리 분석한다. AI의 모델은 실제 Web KaTrain 엔진.
  useEffect(()=>{
    if(!isAnalysisMode)return;
    const state=useGameStore.getState();
    const key=currentNode.id+':'+state.settings.katagoModelUrl;
    if(currentNode.analysis?.moves?.length || requestKeys.current.has(key))return;
    if (currentPlayer==='white' && !currentNode.move) return;
    requestKeys.current.add(key);
    void state.runAnalysis({ifIdle:true,visits:state.board.length===19?48:state.board.length===13?100:160,maxTimeMs:state.board.length===19?8000:6500,topK:22}).catch(()=>{requestKeys.current.delete(key);});
  },[currentNode, currentPlayer, isAnalysisMode, settings.katagoModelUrl, treeVersion]);

  const lastBlack=useMemo(()=>lastOf(currentNode,'black'),[currentNode,treeVersion]);
  const lastWhite=useMemo(()=>lastOf(currentNode,'white'),[currentNode,treeVersion]);
  const suggestions=useMemo(()=>currentPlayer==='black'?sorted(currentNode).filter(o=>o.x>=0&&o.y>=0&&isValidMove(board,o.x,o.y,'black',currentNode.parent?.gameState.board)).slice(0,3):[],[currentNode,treeVersion,currentPlayer,board]);
  const coaching=useMemo(()=>explain(lastBlack),[lastBlack,treeVersion]);
   const selectedCandidate=suggestions.find(o=>`${o.x},${o.y}`===highlight);
  const latest=moveHistory[moveHistory.length-1];
  const endedByPass=moveHistory.length>=2 && isPass(moveHistory[moveHistory.length-1]) && isPass(moveHistory[moveHistory.length-2]);
  const endedByResign=Boolean(currentNode.endState?.includes('+R'));
  const finished=endedByPass || endedByResign;
  const autoEnded=Boolean(currentNode.note?.startsWith('연습 대국 자동 종료 ·'));
  const score=useMemo(()=>scoreChinese(board,6.5),[board]);
  const isReviewing=showReview;
  const boardSize=board.length;
  const canZoom=boardSize>9;
  const earlyWinner=overwhelmingPracticeWinner(board,moveHistory.length,capturedWhite,capturedBlack);
  const viewingReview=activeTab==='review';
  const frame=viewingReview?(reviewFrames[reviewIndex]??null):null;
  const displayBoard=frame?.gameState.board??board;
  const displayHistory=frame?.gameState.moveHistory??moveHistory;
  const displayMove=frame?.move??(frame?null:latest);
  const displaySize=displayBoard.length;
  const displayGridGap=290/(displaySize-1);
  const displayStoneRadius=Math.min(16.4,displayGridGap*0.45);
  const displayHitRadius=Math.max(8,displayGridGap*0.49);
  const displayStarPoints=displaySize===19?[[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]:displaySize===13?[[3,3],[3,9],[6,6],[9,3],[9,9]]:[[2,2],[2,6],[4,4],[6,2],[6,6]];
  const weakest=useMemo(()=>weakBlackGroup(displayBoard),[displayBoard]);
  const markers=useMemo(()=>weakest?{danger:new Set(weakest.stones.map(p=>`${p.x},${p.y}`)),liberties:new Set(weakest.liberties.map(p=>`${p.x},${p.y}`))}:{danger:new Set<string>(),liberties:new Set<string>()},[weakest]);
  const currentCandidates=suggestions;
  const reviewHighlights=useMemo(()=>reviewMoments(reviewFrames),[reviewFrames]);
  const reviewSummary=useMemo(()=>summarizeReview(reviewFrames),[reviewFrames]);
  const currentLesson=LESSONS[lessonIndex]!;
  const lessonCorrect=Boolean(lessonGuess&&(currentLesson.kind==='corner'?(lessonGuess.x===0||lessonGuess.x===4)&&(lessonGuess.y===0||lessonGuess.y===4):(lessonGuess.x===currentLesson.answer.x&&lessonGuess.y===currentLesson.answer.y)));

  // 흑/백 어느 쪽이든 지나치게 많은 돌을 잡혀 대국이 사실상 일방적이면
  // 초보용 연습 대국을 자동으로 마무리한다. 정상적인 규칙의 계가와는 구별한다.
  useEffect(()=>{
    if (!earlyWinner || finished || showReview || isAiThinking) return;
    const s=useGameStore.getState();
    if (s.currentNode.id!==currentNode.id || s.currentNode.endState) return;
    const winnerText=earlyWinner==='black'?'흑':'백';
    s.currentNode.note=`연습 대국 자동 종료 · ${winnerText}의 압도적인 포획 우세 (공식 계가 아님)`;
    // 기존 대국 종료 처리로 SGF 결과 기록까지 남긴다.
    s.resign(earlyWinner==='black'?'white':'black');
  },[earlyWinner,finished,showReview,isAiThinking,currentNode]);

  // 로딩 도중 이전 모델 이름이 남더라도 '선택한 모델'을 정확히 판정한다.
  const fullModel=!isSmallKataGoModel(settings.katagoModelUrl);

  function restoreBasicModel(message?:string) {
    const store=useGameStore.getState();
    store.updateSettings({katagoModelUrl:BASIC_MODEL_URL,katagoBackend:'wasm'});
    requestKeys.current.clear();
    setNote(message??'가벼운 기본 모델로 돌아왔어. 다시 착수하거나 백 응수 버튼을 눌러 줘.');
    // 기존 국면에서 즉시 작은 모델로 새 탐색을 요청한다.
    void useGameStore.getState().runAnalysis({force:true,ifIdle:true,visits:100,maxTimeMs:6500,topK:15}).catch(()=>{
      setNote('기본 모델도 시작되지 않으면 Safari에서 페이지를 새로고침해 줘.');
    });
  }

  // 96MB 강화 모델은 iPhone Safari의 메모리 / 외부 파일 접근 문제로
  // 실패할 수 있다. 실패 후 같은 모델을 무한 재시도하지 않고 기본 모델로 복귀한다.
  useEffect(()=>{
    if(engineStatus!=='error' || !fullModel) return;
    const attemptedUrl=settings.katagoModelUrl;
    if(failedModelRecovery.current===attemptedUrl)return;
    failedModelRecovery.current=attemptedUrl;
    const reason=(engineError??'알 수 없는 로딩 오류').slice(0,160);
    const timer=window.setTimeout(()=>{
      if(useGameStore.getState().settings.katagoModelUrl!==attemptedUrl)return;
      restoreBasicModel(`강화 KataGo가 이 아이폰에서 실행되지 않아 기본 모델로 돌아왔어. 오류: ${reason}`);
    },0);
    return ()=>window.clearTimeout(timer);
  },[engineStatus,engineError,fullModel,settings.katagoModelUrl]);

  function play(x:number,y:number) {
    const s=useGameStore.getState();
    if(activeTab!=='play'||finished || s.currentPlayer!=='black' || s.isAiThinking || isReviewing)return;
    if(!isValidMove(s.board,x,y,'black',s.currentNode.parent?.gameState.board)) {setNote('거기는 둘 수 없는 자리야. 다른 교차점을 눌러 줘.');return;}
    s.playMove(x,y);
    setShowSuggestions(false);setHighlight(null);setNote('');setHintStep(0);setOverlayMode('none');setShowHintPanel(false);
  }
  function newGame(){
    const s=useGameStore.getState();
    s.startNewGame({boardSize:boardSize as 9|13|19,rules:'chinese',komi:6.5,handicap:0});
    if(!useGameStore.getState().isAnalysisMode)useGameStore.getState().toggleAnalysisMode();
    requestKeys.current.clear();
    setNote('');setAskText('');setAskAnswer('');setShowSuggestions(false);setHighlight(null);setShowReview(false);setConfirmNew(false);setBusyMove(false);setShowBoardSizes(false);setActiveTab('play');setHintStep(0);setOverlayMode('none');setShowHintPanel(false);
  }
  function changeBoardSize(next: 9|13|19) {
    setShowBoardSizes(false);
    if(next===boardSize)return;
    // Explicitly warn: switching sizes is a new game, not a zoom of the old game.
    if(moveHistory.length>0 && !window.confirm(`현재 대국을 종료하고 ${next}×${next} 새 판으로 시작할까요? 진행 중인 기보는 먼저 SGF로 저장할 수 있어요.`))return;
    const game=useGameStore.getState();
    game.updateSettings({defaultBoardSize:next});
    game.startNewGame({boardSize:next,rules:'chinese',komi:6.5,handicap:0});
    if (!useGameStore.getState().isAnalysisMode)useGameStore.getState().toggleAnalysisMode();
    requestKeys.current.clear();
    setBoardZoomed(next===19);
    setShowSuggestions(false);setHighlight(null);setShowReview(false);setConfirmNew(false);setAskAnswer('');setAskText('');setBusyMove(false);
    setHintStep(0);setOverlayMode('none');setShowHintPanel(false);setActiveTab('play');setNote(`${next}×${next} 새 판이야. ${next===19?'교차점을 누르기 쉽게 판을 확대해 뒀어. 좌우로 밀어서 이동할 수 있어.':'흑돌부터 두면 돼.'}`);
  }

  function whiteReply(){
    if(finished || currentPlayer!=='white' || isAiThinking || busyMove)return;
    setBusyMove(true);
    // 버튼 한 번만 눌러, 과외 내용과 대안부터 읽을 시간을 준다.
    useGameStore.getState().makeAiMove({force:true});
    setTimeout(()=>setBusyMove(false),850);
  }
  function changeLevel(n:18|12|7){setLevel(n);useGameStore.getState().updateSettings({aiStrategy:'rank',aiRankKyu:n});}
  function stronger(){
    if(fullModel)return;
    if(!window.confirm('강화 모델은 약 96MB이며 iPhone Safari에서 메모리 또는 다운로드 문제로 실행되지 않을 수 있어. 실패하면 자동으로 기본 모델로 돌아갈게. 시도할까?'))return;
    failedModelRecovery.current=null;
    useGameStore.getState().updateSettings({katagoModelUrl:KATAGO_RECOMMENDED_MODEL_URL});
    requestKeys.current.clear();
    setNote('강화 모델을 불러오는 중이야. 아이폰에 따라 실행되지 않을 수 있어. 실패하면 기본 모델로 복구할게.');
    void useGameStore.getState().runAnalysis({force:true,ifIdle:true,visits:60,maxTimeMs:9000,topK:10}).catch(()=>{
      // engineStatus가 'error'로 바뀌면 위의 자동 복구가 처리한다.
    });
  }
  function saveSgf(){
    const text=generateSgfFromTree(useGameStore.getState().rootNode);
    const blob=new Blob([text],{type:'application/x-go-sgf;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='바둑한수_대국기록.sgf';document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  const lastBlackTurn=lastBlack?.gameState.moveHistory.length??0;
  const lastWhiteTurn=lastWhite?.gameState.moveHistory.length??0;
  const whiteMove=lastWhite?.move;
  const whitePassed=Boolean(whiteMove && isPass(whiteMove) && lastWhiteTurn>lastBlackTurn);


  function undoTurn() {
    const store=useGameStore.getState();
    if(finished || !store.currentNode.parent || store.isAiThinking)return;
    // 백이 이미 응수했다면 백/흑 한 차례를 한꺼번에 무른다.
    const undoTwice=store.currentPlayer==='black' && store.currentNode.move?.player==='white' &&
      store.currentNode.parent?.move?.player==='black';
    store.undoMove();
    if (undoTwice) useGameStore.getState().undoMove();
    setShowReview(false);setShowSuggestions(false);setHighlight(null);setNote('착수를 무르고 다시 선택할 수 있어요.');
  }
  function endReview(){setActiveTab('play');setReviewPractice(false);setReviewGuess(null);setHighlight(null);}
  function openCurrentReview(atStart=false){
    const frames=currentPath(useGameStore.getState().currentNode);
    setReviewFrames(frames);setReviewIndex(atStart?0:frames.length-1);setReviewLabel('현재 대국');
    setReviewPractice(false);setReviewGuess(null);setActiveTab('review');setOverlayMode('none');
  }
  function goTab(next:CoachTab){
    if(next==='review'){openCurrentReview();return;}
    setActiveTab(next);setReviewPractice(false);setReviewGuess(null);setOverlayMode('none');setHintStep(0);
  }
  function reviewStep(delta:number){setReviewIndex(i=>Math.max(0,Math.min(reviewFrames.length-1,i+delta)));setReviewGuess(null);}
  function reviewJump(i:number){setReviewIndex(Math.max(0,Math.min(reviewFrames.length-1,i)));setReviewGuess(null);}
  function reviewAgain(){
    // 현재 장면이 흑돌을 둔 직후라면 이전 국면에서 선택해 보게 한다.
    let i=reviewFrames[reviewIndex]?.move?.player==='black'?Math.max(0,reviewIndex-1):reviewIndex;
    while(i>0&&reviewFrames[i]?.gameState.currentPlayer!=='black')i--;
    setReviewIndex(i);setReviewGuess(null);setReviewPractice(true);window.scrollTo({top:0,behavior:'smooth'});
  }
  function lessonTry(x:number,y:number){
    if(currentLesson.stones.some(st=>st.x===x&&st.y===y))return;
    setLessonGuess({x,y});
    if(currentLesson.kind==='corner'?(x===0||x===4)&&(y===0||y===4):(currentLesson.answer.x===x&&currentLesson.answer.y===y)){
      const dayKey='baduk-seven-lessons-'+new Date().toLocaleDateString('sv-SE');
      const next=[...new Set([...dailyDone,lessonIndex])];setDailyDone(next);
      try{window.localStorage.setItem(dayKey,JSON.stringify(next));}catch{/* private Safari */}
    }
  }
  function changeLesson(i:number){setLessonIndex(i);setLessonGuess(null);}
  async function copySgf(){
    try { await navigator.clipboard.writeText(generateSgfFromTree(useGameStore.getState().rootNode));setNote('기보를 복사했어요.'); }
    catch {setNote('자동 복사가 제한되어 있어요. SGF 저장 버튼을 이용해 주세요.');}
  }
  function openSaved(g: SavedGame){
    try{
      // 저장된 기보를 복기 탭에서만 펼친다. 현재 진행 중인 대국은 절대로 덮어쓰지 않는다.
      const frames=savedReplay(g.sgf);
      setReviewFrames(frames);setReviewIndex(0);setReviewLabel(`${g.date} · ${g.result}`);
      setReviewPractice(false);setReviewGuess(null);setActiveTab('review');setNote('저장된 대국을 복기 탭에서 열었어. 현재 대국은 그대로 남아 있어.');
    }catch {setNote('저장된 기보를 읽지 못했어. 다른 대국을 선택해 줘.');}
  }
  function askCoach(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const q=askText.trim();if(!q)return;
    let a='그 질문은 이 무료 버전에서 정확하게 이해하기 어려워요. ‘왜’, ‘위험’, ‘단수’, ‘집’, ‘추천’, ‘백’, ‘복기’ 같은 말로 다시 물어봐 줘요.';
    const group=lastBlack?.move && board[lastBlack.move.y]?.[lastBlack.move.x]==='black'
      ?getLiberties(board,lastBlack.move.x,lastBlack.move.y):null;
    if(/귀|모서리/.test(q)) a=GO_TERMS['귀'];
    else if(/변|가장자리/.test(q)) a=GO_TERMS['변'];
    else if(/중앙|가운데/.test(q)) a=GO_TERMS['중앙'];
    else if(/두 눈|두눈/.test(q)) a=GO_TERMS['두 눈'];
    else if(/활로.*뜻|활로.*뭐|활로가 뭐/.test(q)) a=GO_TERMS['활로'];
    else if(/단수.*뜻|단수.*뭐|단수가 뭐/.test(q)) a=GO_TERMS['단수'];
    else if(/패스.*왜|백.*패스/.test(q)) a='백은 더 두어 얻을 이득이 적다고 판단하면 패스하기도 해. 다만 작은 연습용 모델은 너무 일찍 패스할 수도 있어. 패스해도 승리나 종료가 확정된 건 아니고, 두 사람이 연속으로 패스해야 끝나.';
    else if(/추천|더 좋|어디|대안|최선/.test(q)) a=suggestions.length
      ?`KataGo가 이 자리 직전에 추천한 곳은 ${suggestions.map((p,i)=>`${i+1}순위 ${spot(p.x,p.y,boardSize)}`).join(', ')}예요. 그곳을 누르면 바둑판에 표시할 수 있어요.`
      :'지금은 비교할 수 있는 KataGo 후보가 없어요. 다음 흑 차례에서 분석이 완료되면 보여 줄게요.';
    else if(/위험|단수|활로|잡히|살려|죽/.test(q)) a=group
      ?`가장 최근에 둔 흑돌 무리는 활로가 ${group.liberties}개예요. ${group.liberties===1?'단수여서 바로 살리는 수가 필요할 수 있어요.':group.liberties===2?'조만간 공격받기 쉬우니 주변 백돌을 주의해 봐요.':'현재 단수는 아니지만 다른 흑돌 무리는 별도로 확인해야 해요.'}`
      :'현재 판에서 최근 흑돌 무리의 활로를 바로 확인할 수 없어요. 주변 빈 교차점부터 살펴봐요.';
    else if(/집|눈|사활/.test(q)) a='집은 상대가 들어오기 어려운 빈 교차점이고, 두 눈은 돌이 잡히지 않도록 하는 독립된 두 공간이에요. 집이 넓어도 두 눈이 없으면 잡힐 수 있어요.';
    else if(/왜|아쉬|좋은|나쁜|실수|평가/.test(q)) a=lastBlack
      ?`${coaching.detail} ${coaching.facts[0]??''}`
      :'아직 흑이 둔 수가 없어요. 바둑판의 교차점을 터치해 첫 수를 둬 봐요.';
    else if(/백|응수|상대|싸움/.test(q)) a=whitePassed?'백이 이번 차례를 패스했어. 지금 둘 만한 좋은 곳이 없다고 판단했을 수 있지만, 작은 모델이 너무 빨리 패스할 때도 있어. 아직 할 수 있는 수가 있다면 그대로 흑돌을 둬도 돼.':whiteMove&&lastWhiteTurn>lastBlackTurn
      ?`백은 ${spot(whiteMove.x,whiteMove.y,boardSize)}에 두었어요. 지금은 그 부근의 흑돌 연결과 활로를 확인하는 게 좋아요. 백의 구체적 의도는 단순히 좌표만으로 단정할 수 없어요.`
      :'백 응수 버튼을 누르면 KataGo가 실제 탐색으로 수를 선택해요. 해설을 먼저 보고 백을 진행해 봐요.';
    else if(/복기|기보|저장/.test(q)) a='화면 위쪽의 ‘복기’ 탭을 눌러 줘. 실제 대국을 건드리지 않고 이전/다음 수를 넘겨 볼 수 있어. 한 장면에서 다시 두어 보는 연습도 할 수 있어.';
    setAskAnswer(a);setAskText('');
  }

  useEffect(()=>{
    if(!finished)return;
    const id=String(useGameStore.getState().rootNode.id);
    if(recorded.current.has(id))return;
    recorded.current.add(id);
    const sgf=generateSgfFromTree(useGameStore.getState().rootNode);
    const result=autoEnded?`${currentNode.endState?.startsWith('B')?'흑':'백'} 자동 승리 (연습 규칙)`:endedByResign?'기권':`${score.winner} ${score.margin.toFixed(1)}집 승 (잠정)`;
    const entry:SavedGame={id,date:new Date().toLocaleDateString('ko-KR'),moves:moveHistory.length,result,sgf};
    const next=[entry,...readSavedGames().filter(g=>g.id!==id)].slice(0,12);
    try{window.localStorage.setItem('my-go-coach:completed-games',JSON.stringify(next));}
    catch{ /* Safari storage may be disabled; the current game stays available. */ }
    window.setTimeout(()=>setSavedGames(next),0);
  },[finished,endedByResign,moveHistory.length,score.winner,score.margin]);
  return <main className="ew-app" lang="ko">
    <style>{`
      .ew-app{--ink:#232c28;--green:#275a44;--softgreen:#e9f4e9;--muted:#84918a;--line:#e6e5df;--paper:#f8f6f1;min-height:100vh;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;font-size:14px;line-height:1.5;padding:18px 19px 48px;font-weight:400}
      .ew-app *{box-sizing:border-box}.ew-app button,.ew-app input,.ew-app select{font-family:inherit}.ew-wrap{max-width:420px;margin:0 auto;min-width:0}
      .ew-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin:0 0 20px}.ew-brand{display:flex;gap:11px;align-items:center;min-width:0}
      .ew-logo{width:43px;height:43px;background:#17241e;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative}
      .ew-logo::before{content:'';width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;left:11px;top:9px}.ew-logo::after{content:'';width:20px;height:20px;border-radius:50%;background:#17241e;border:2px solid #fff;position:absolute;left:18px;top:18px}
      .ew-kicker{font-size:9px;letter-spacing:.26em;color:#8d9b90;font-weight:900;line-height:1.3}.ew-brandname{font-size:22px;font-weight:900;letter-spacing:-.065em;line-height:1.2;white-space:nowrap}
      .ew-status{font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:20px;color:#387253;background:#e7f1e8;white-space:nowrap;flex-shrink:0}.ew-led{display:block;width:7px;height:7px;background:#387253;border-radius:50%}.ew-error{color:#a44e41;background:#fae7e2}.ew-error .ew-led{background:#b64d3f}.ew-idle .ew-led,.ew-loading .ew-led{background:#b59c62}
      .ew-preface{display:flex;align-items:center;justify-content:space-between;gap:9px;margin:0 0 16px}.ew-preface-left{min-width:0}.ew-turnlabel{display:flex;align-items:center;gap:6px;font-weight:850;font-size:14px;letter-spacing:-.02em}
      .ew-mini-black{width:15px;height:15px;display:inline-block;border-radius:50%;background:#1d2422;flex-shrink:0}.ew-mini-white{width:16px;height:16px;display:inline-block;border-radius:50%;background:linear-gradient(140deg,#fff,#e6e8e9);border:1px solid #cbd0cc;flex-shrink:0}.ew-mini-line{color:#9aa5a0;font-size:12px;line-height:1.2;font-weight:400;margin-top:7px}.ew-preface-level{display:flex;gap:6px;align-items:center;white-space:nowrap;color:#7b887f;font-size:12px}.ew-preface-level select{appearance:auto;min-width:80px;max-width:88px;border:1px solid #e1e5de;border-radius:11px;min-height:41px;background:#fff;color:#365447;padding:6px 8px;font-size:13px;font-weight:800}
      .ew-boardwrap{background:#e3bf87;border:6px solid #efd39e;border-radius:18px;overflow:hidden;box-shadow:0 3px 8px #a6804933;touch-action:manipulation}.ew-board{display:block;width:100%;height:auto;user-select:none;-webkit-user-select:none;touch-action:manipulation}.ew-click{cursor:pointer}.ew-click:focus-visible{stroke:#208157;stroke-width:3px}.ew-piece-b{fill:#1c211f;stroke:#161a19;stroke-width:1}.ew-piece-w{fill:#fafafa;stroke:#aaa;stroke-width:1.15}
      .ew-scoreline{display:flex;justify-content:space-between;gap:8px;margin:0 1px 8px;font-size:12px;color:#718078;align-items:center}.ew-prisoner{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.ew-prisoner strong{font-weight:850}.ew-scoreline-right{font-weight:850;white-space:nowrap}
      .ew-toolbar{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:9px 0 9px}.ew-toolbar-main{display:grid;grid-template-columns:minmax(0,1.8fr) repeat(2,minmax(0,1fr));gap:7px;align-items:stretch}.ew-toolbar-main .ew-tool{width:100%;min-width:0;padding:10px 5px;font-size:12px;white-space:nowrap}.ew-toolbar-main .ew-tool-primary{font-size:clamp(11px,3.1vw,13px);padding-left:4px;padding-right:4px}.ew-toolbar-secondary{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.ew-aftercoach{margin:8px 0 0}.ew-aftercoach .ew-tool{min-height:37px;padding:7px 10px;font-size:12px}.ew-tool-primary{background:#295d45!important;border-color:#295d45!important;color:#fff!important}.ew-tool-primary:disabled{background:#e7eee8!important;border-color:#dfe7de!important;color:#778b7c!important;opacity:1!important}.ew-tool-size{background:#edf5ef!important;color:#245a43!important;border-color:#cde0d0!important}.ew-size-options{background:#fff;border:1px solid #dfe5dd;border-radius:12px;padding:12px;margin:0 0 12px}.ew-size-options strong{font-size:13px;color:#294e39;display:block;margin-bottom:8px}.ew-size-buttons{display:flex;gap:6px;flex-wrap:wrap}.ew-size-btn{min-height:43px;border-radius:9px;background:#fafbf9;border:1px solid #d7e0d7;padding:8px 12px;font-size:13px;font-weight:800;color:#54705d}.ew-size-active{background:#2c624a;color:#fff;border-color:#2c624a}.ew-size-options small{display:block;margin-top:8px;color:#788b7c;line-height:1.5}.ew-next-hint{font-size:12px;color:#427158;margin:0 0 13px;line-height:1.55}.ew-board-area{margin:0}.ew-boardwrap{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}.ew-boardtools{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;align-items:center;margin:0 0 7px;color:#8b8f85;font-size:11px}.ew-zoom{border:0;background:#e7eee6;color:#3d694e;border-radius:7px;padding:7px 10px;font-weight:800;font-size:11px;min-height:34px}.ew-tool{appearance:none;background:#fff;border:1px solid #dfe4de;border-radius:12px;min-height:44px;padding:10px 13px;font-size:13px;font-weight:850;color:#4f5d53;cursor:pointer}.ew-tool:disabled{opacity:.38;cursor:default}.ew-tool-text{background:transparent;border-color:transparent;color:#8b7661}.ew-tool:focus-visible,.ew-submit:focus-visible,.ew-pick:focus-visible{outline:3px solid #b1c8bb;outline-offset:2px}
      .ew-readycard{background:var(--softgreen);border:1px solid #83b18d;border-radius:15px;padding:15px 16px;display:flex;align-items:center;gap:10px;justify-content:space-between;margin:0 0 14px;flex-wrap:wrap}.ew-readycopy{min-width:0;flex:1}.ew-readytitle{font-size:15px;font-weight:900;letter-spacing:-.02em}.ew-readyhint{font-size:12px;line-height:1.35;color:#779080;margin-top:6px}.ew-replybtn{border-radius:99px;min-height:48px;border:1px solid #275a44;background:#275a44;white-space:nowrap;padding:11px 18px;font-size:14px;font-weight:900;color:#fff;cursor:pointer;flex-shrink:0}.ew-replybtn:disabled{opacity:.55;cursor:default}
      .ew-card{border:1px solid #e5e4de;background:#fff;border-radius:18px;padding:18px 19px;margin-top:14px;min-width:0}.ew-coachcard{margin:0 0 12px;border-color:#d8e4d9}.ew-judgment{display:block;font-size:15px;color:#305c43;margin-top:6px}.ew-cardtop{display:flex;justify-content:space-between;align-items:center;gap:8px}.ew-cardheading{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:900;letter-spacing:-.03em;color:#2d3430}.ew-icon{border-radius:10px;background:#eaf0e9;display:flex;align-items:center;justify-content:center;width:31px;height:31px;font-size:18px;color:#4a8662;flex-shrink:0}.ew-icon-warm{background:#f3ecdf;color:#a08659}.ew-icon-blue{background:#eaedf4;color:#657a94}.ew-badge{font-size:12px;color:#76867b;background:#ecf0ec;padding:6px 11px;border-radius:99px;white-space:nowrap;font-weight:700}.ew-title-explain{margin:7px 0 5px;color:#53665c;font-size:14px;line-height:1.65}.ew-lessonbox{background:#f0f5ef;border:1px solid #e1ebdf;border-radius:12px;padding:12px 13px;margin:7px 0}.ew-lessonlabel{color:#457356;font-size:12px;font-weight:850}.ew-lessonbox p{font-size:13px;line-height:1.72;color:#566d5d;margin:8px 0 0}.ew-fact{font-size:12px;line-height:1.55;margin-top:7px;color:#526457}.ew-parttitle{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:14px 0 9px;font-size:12px;font-weight:900;color:#4b7b59}.ew-parttitle small{font-size:11px;color:#a0ada5;font-weight:400}.ew-picks{display:flex;gap:5px;flex-wrap:wrap}.ew-pick{background:#eaf1e8;border:1px solid #d1e2d0;border-radius:10px;min-height:36px;padding:6px 11px;font-size:12px;color:#426947;font-weight:800;cursor:pointer}.ew-pick.ew-active{background:#2b6b49;border-color:#2b6b49;color:#fff}.ew-muted{font-size:11px;color:#9aa7a0;line-height:1.6;margin:9px 0 0}.ew-browntip{font-size:12px;color:#7e8b81;line-height:1.65;margin:6px 0 0}
      .ew-question-desc{font-size:13px;color:#8a978f;margin:12px 0 13px;line-height:1.65}.ew-form{display:flex;border-radius:13px;background:#f6f7f5;border:1px solid #e1e8e1;padding:5px;gap:6px;align-items:center}.ew-input{border:0;outline:none;background:transparent;font-size:16px;line-height:1.4;padding:10px 7px 10px 9px;flex:1;min-width:0;width:10px;color:#263a2d}.ew-input::placeholder{color:#99a29b}.ew-submit{width:41px;height:41px;border-radius:11px;border:0;background:#99b0a3;color:white;font-size:24px;cursor:pointer;flex-shrink:0}.ew-submit:disabled{opacity:.5;cursor:default}.ew-chatanswer{font-size:13px;line-height:1.6;padding:12px;background:#f0f5ee;border-radius:10px;margin:9px 0 0;color:#355743}.ew-smallnote{font-size:11px;color:#99a69d;margin:11px 0 0;line-height:1.7}
      .ew-paragraph{font-size:13px;line-height:1.7;color:#88988d;margin:11px 0 15px}.ew-recordbtns{display:flex;gap:7px;flex-wrap:wrap}.ew-recordbtn{border:1px solid #dce4db;background:#f8f9f7;color:#5c7162;border-radius:10px;min-height:40px;padding:8px 10px;font-size:12px;font-weight:750;cursor:pointer}.ew-recordbtn:disabled{opacity:.35;cursor:default}.ew-divider{height:1px;background:#eeeee8;margin:14px 0 10px}.ew-detail{color:#6f8176;font-size:12px}.ew-detail summary{cursor:pointer;list-style:none;font-weight:800}.ew-detail summary::before{content:'▸ ';color:#739780}.ew-detail[open] summary::before{content:'▾ '}.ew-moves{display:flex;gap:6px;flex-wrap:wrap;margin:11px 0 0}.ew-movepill{border:1px solid #e2e7df;border-radius:7px;padding:5px 7px;background:#f9faf8;font-size:11px;color:#67786c}.ew-savedentry{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #ecede8}.ew-savedentry:first-child{border-top:none}.ew-saved-title{font-size:12px;font-weight:850;color:#405846}.ew-saved-description{font-size:11px;color:#96a398;margin-top:4px}.ew-endresult{font-size:14px;font-weight:900;color:#286342}.ew-notice{background:#fff3e6;border-radius:10px;padding:10px;color:#8b543c;font-size:12px;line-height:1.5;margin:9px 0}.ew-footer{text-align:center;font-size:10px;color:#afb7ad;padding:21px 8px 8px;line-height:2}
      .ew-terms{margin:10px 0 0;border:1px solid #e0e8de;background:#fafcf9;border-radius:11px;padding:10px 12px}.ew-terms summary{cursor:pointer;color:#3e664c;font-weight:850;font-size:12px}.ew-term-grid{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 10px}.ew-term-btn{border-radius:8px;border:1px solid #d9e7d8;background:#fff;color:#3c6748;min-height:36px;padding:6px 10px;font-size:12px;font-weight:750}.ew-term-btn[aria-pressed="true"]{background:#2c6348;color:#fff;border-color:#2c6348}.ew-term-explain{font-size:13px;color:#425d49;line-height:1.65;margin:0;padding:9px;background:#eff5ef;border-radius:8px}.ew-term-visual{display:inline-block;margin-right:6px;font-size:15px}.ew-whitepass{border-left:3px solid #678672;background:#f0f5ee;padding:10px 11px;margin:11px 0 0;border-radius:6px;font-size:12px;line-height:1.7;color:#4d6a52}.ew-modelnote{border-radius:10px;background:#fff7e9;color:#805a35;padding:11px;font-size:12px;line-height:1.65;margin:11px 0}
      .ew-tabs{display:grid;grid-template-columns:repeat(3,1fr);background:#e9ece6;border-radius:14px;padding:4px;gap:3px;margin:0 0 17px}.ew-tab{border:0;border-radius:11px;min-height:43px;background:transparent;font-size:14px;color:#697e6d;font-weight:850}.ew-tab-active{background:#fff;color:#25583e;box-shadow:0 1px 5px #253b2421}
      .ew-coachactions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.ew-expandbtn{border:1px solid #d6e4d8;border-radius:9px;background:white;color:#407151;padding:7px 9px;font-size:12px;font-weight:800;min-height:38px}.ew-expandbtn[aria-pressed=true]{background:#e6f1e8}.ew-deeper{border-left:3px solid #90b69a;background:#f8faf5;font-size:12px;line-height:1.6;padding:10px;color:#526858}.ew-deeper p{margin:5px 0}.ew-hintbox{border:1px solid #d8e5d6;background:#fbfcf8;border-radius:11px;padding:11px 12px;margin:12px 0}.ew-hinthead{display:flex;align-items:center;justify-content:space-between;gap:6px;color:#3b6a46;font-size:13px}.ew-hinthead span{font-size:10px;color:#829689}.ew-hintbox p{margin:7px 0 10px;font-size:12px;line-height:1.6;color:#5a6c5e}.ew-hintbtn{min-height:38px;background:#2b6b49;color:white;border:0;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:850}.ew-hintbtn:disabled{opacity:.5}.ew-hintreset{min-height:38px;background:#fff;color:#7b897e;border:1px solid #e3e8e0;border-radius:8px;padding:8px 10px;font-size:12px}.ew-go-review{margin:16px 0}.ew-go-reviewbtn{min-height:44px;width:100%;background:#eef5ee;border:1px solid #ceddce;color:#336b46;border-radius:12px;font-weight:900;padding:10px 13px;font-size:13px}
      .ew-reviewintro{background:#eaf2e9;border:1px solid #cfdfcf;padding:15px;border-radius:16px;margin-bottom:12px}.ew-reviewtitle{font-size:15px;color:#2c5840;font-weight:900}.ew-reviewintro p{font-size:12px;color:#64816a;line-height:1.5;margin:5px 0 10px}.ew-reviewcounter{font-size:12px;color:#576e5c}.ew-reviewcounter strong{color:#244e37;font-size:17px}.ew-reviewcounter span{font-size:12px}.ew-reviewscrub{accent-color:#2d7350;width:100%;height:34px;margin-top:6px}.ew-reviewcontrols{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.ew-reviewcontrols button{border:1px solid #d4e0d2;border-radius:9px;background:white;color:#3b6749;min-height:39px;font-weight:800;font-size:12px}.ew-reviewcontrols button:disabled{opacity:.4}.ew-reviewpractice{border-color:#d5dec7;background:#fffefa}.ew-reviewlesson{border-color:#cbdccf}.ew-moments{display:grid;gap:7px}.ew-moment{text-align:left;border:1px solid #dfe8de;border-radius:11px;background:#f7faf5;padding:10px 12px;display:flex;flex-direction:column;gap:4px;color:#46634b}.ew-moment strong{font-size:12px}.ew-moment span{font-size:11px;line-height:1.45}.ew-reviewtakeaways{background:#f4f7f0;border-radius:12px;padding:10px 13px;color:#596a58;font-size:12px;line-height:1.7}.ew-reviewtakeaways p{margin:5px 0}.ew-lessonchips{display:flex;flex-wrap:wrap;gap:6px;margin:11px 0}.ew-lessonchip{font-size:12px;min-height:40px;padding:9px 11px;background:#f7faf7;color:#477457;border:1px solid #d7e5d5;border-radius:9px;font-weight:800}.ew-lessonchip-active{color:#fff;background:#2c6549;border-color:#2c6549}.ew-quiztitle{font-size:14px;color:#304e3a;font-weight:850}.ew-teachingboard{display:block;width:min(100%,230px);height:auto;margin:12px auto;border-radius:13px;touch-action:manipulation}.ew-quizgood,.ew-quizretry{font-size:13px;line-height:1.65;border-radius:10px;padding:11px}.ew-quizgood{color:#29683e;background:#e5f4e8}.ew-quizretry{color:#916931;background:#fff2de}.ew-termstudy{background:#f7faf5;padding:10px;border-radius:12px}.ew-termstudy h3{margin:4px 0;color:#315e40}.ew-termstudy p{margin:6px 0;font-size:13px;line-height:1.6;color:#526857}.ew-progress{font-weight:900;font-size:12px;color:#36724d;background:#e9f3e9;padding:8px 10px;border-radius:9px;display:inline-block}
      @media(min-width:700px){.ew-app{padding-top:26px}.ew-wrap{max-width:440px}}@media(max-width:360px){.ew-app{padding-left:12px;padding-right:12px}.ew-replybtn{padding:9px 10px;font-size:12px}.ew-preface-level{font-size:11px}.ew-brandname{font-size:20px}.ew-tool{padding:10px}}
    `}</style>
    <div className="ew-wrap">
      <header className="ew-head">
        <div className="ew-brand"><span className="ew-logo" aria-hidden="true"/><div><div className="ew-kicker">MY GO COACH</div><div className="ew-brandname">바둑 한 수</div></div></div>
        <StatusDot status={engineStatus}/>
      </header>
      <nav className="ew-tabs" aria-label="바둑 한 수 카테고리">
        <button type="button" className={activeTab==='play'?'ew-tab ew-tab-active':'ew-tab'} aria-current={activeTab==='play'?'page':undefined} onClick={()=>goTab('play')}>⚫ 대국</button>
        <button type="button" className={activeTab==='review'?'ew-tab ew-tab-active':'ew-tab'} aria-current={activeTab==='review'?'page':undefined} onClick={()=>goTab('review')}>↶ 복기</button>
        <button type="button" className={activeTab==='learn'?'ew-tab ew-tab-active':'ew-tab'} aria-current={activeTab==='learn'?'page':undefined} onClick={()=>goTab('learn')}>📚 배우기</button>
      </nav>
      {resumeMessage&&<div className="ew-notice" role="status" style={{marginTop:-6,marginBottom:13,background:'#e9f4e9',color:'#306545'}}>{resumeMessage}</div>}
      <div role="status" style={{fontSize:11,lineHeight:1.5,color:autosaveState==='error'?'#a75040':'#6a8f74',textAlign:'right',marginTop:-11,marginBottom:9}}>
        {autosaveState==='saved'?'✓ 이 기기에 자동 저장 중 · 다음 방문에 이어하기':autosaveState==='error'?'⚠️ 자동 저장 실패 · 복기 탭에서 SGF 파일로 백업해 줘':'저장 준비 중'}
      </div>

      {activeTab==='play'&&<><div className="ew-preface">
        <div className="ew-preface-left">
          <div className="ew-turnlabel"><span className="ew-mini-black"/><span className="ew-mini-white"/> {finished?'대국 종료':showReview?'한 수씩 복기 중':currentPlayer==='white'?'백의 응수 확인':'흑 차례 · 착수하기'}</div>
          <div className="ew-mini-line">{finished?'기보와 계가를 확인해 봐요.':showReview?'원하는 수로 돌아가 살펴봐요.':currentPlayer==='white'?'바둑판 바로 아래 ‘백 응수 두기’를 눌러줘요.':'바둑판의 교차점을 터치해 보세요.'}</div>
        </div>
        <label className="ew-preface-level">백의 실력 <select aria-label="백의 실력" value={level} onChange={(e:{target:{value:string}})=>changeLevel(Number(e.target.value) as 18|12|7)}><option value={18}>입문</option><option value={12}>초급</option><option value={7}>도전</option></select></label>
      </div>

      </>}
      {activeTab==='review'&&<section className="ew-reviewintro"><div className="ew-reviewtitle">📖 기보만 집중해서 보는 공간</div><p>{reviewLabel} · {Math.max(0,reviewFrames.length-1)}수. 대국 화면과 분리되어 있어 실수로 착수하지 않아.</p><div className="ew-reviewcounter"><strong>{reviewIndex}수</strong> / {Math.max(0,reviewFrames.length-1)}수 <span>{reviewFrames[reviewIndex]?.move ? `· ${reviewFrames[reviewIndex]!.move!.player==='black'?'흑':'백'} ${spot(reviewFrames[reviewIndex]!.move!.x,reviewFrames[reviewIndex]!.move!.y,displaySize)}` : '· 시작 장면'}</span></div>
          <input type="range" className="ew-reviewscrub" aria-label="복기 수 선택" min={0} max={Math.max(0,reviewFrames.length-1)} value={reviewIndex} onChange={(e:{target:{value:string}})=>reviewJump(Number(e.target.value))}/>
          <div className="ew-reviewcontrols"><button type="button" onClick={()=>reviewJump(0)} disabled={reviewIndex===0}>처음</button><button type="button" onClick={()=>reviewStep(-1)} disabled={reviewIndex===0}>◀ 이전</button><button type="button" onClick={()=>reviewStep(1)} disabled={reviewIndex>=reviewFrames.length-1}>다음 ▶</button><button type="button" onClick={()=>reviewJump(reviewFrames.length-1)} disabled={reviewIndex>=reviewFrames.length-1}>마지막</button></div>
        </section>}
      {activeTab!=='learn'&&<><div className="ew-scoreline"><div className="ew-prisoner"><span><span className="ew-mini-black" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {frame?.gameState.capturedWhite??capturedWhite}</span><span>·</span><span><span className="ew-mini-white" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {frame?.gameState.capturedBlack??capturedBlack}</span></div><span className="ew-scoreline-right">{displayHistory.length}수</span></div>

      <div className="ew-board-area">
        <div className="ew-boardwrap" aria-label={`${displaySize}×${displaySize} 바둑판`}>
          <svg className="ew-board" style={{minWidth:boardZoomed&&displaySize>9?(displaySize===19?650:510):undefined}} viewBox="0 0 380 380" role="group" aria-label={`${displaySize}줄 바둑판`}>
            <rect width="380" height="380" fill="#e3bf87"/>
            {Array.from({length:displaySize},(_,i)=>{const yp=42+i*displayGridGap,xp=47+i*displayGridGap;return <g key={`line${i}`} stroke="#8a6b48" strokeWidth={displaySize===19?0.8:1.1}><line x1={47} x2={337} y1={yp} y2={yp}/><line x1={xp} x2={xp} y1={42} y2={332}/></g>;})}
            {displayStarPoints.map(([x,y])=><circle key={`star${x}${y}`} cx={47+x*displayGridGap} cy={42+y*displayGridGap} r={displaySize===19?2.2:3.1} fill="#79583b"/>)}
            {Array.from({length:displaySize},(_,i)=><g key={`coord${i}`} fill="#846c50" fontSize={displaySize===19?8.5:displaySize===13?10:12} textAnchor="middle"><text x="23" y={45.5+i*displayGridGap}>{displaySize-i}</text><text x={47+i*displayGridGap} y="357">{AXIS[i]}</text></g>)}
            {displayBoard.map((row,y)=>row.map((stone,x)=>{
              const cx=47+x*displayGridGap,cy=42+y*displayGridGap;
              const marked=activeTab==='play'&&showSuggestions?suggestions.findIndex(o=>o.x===x&&o.y===y):-1;
              const selected=highlight===`${x},${y}`;
              const atLast=displayMove?.x===x&&displayMove?.y===y;
              const canReviewGuess=viewingReview&&reviewPractice&&!stone&&frame?.gameState.currentPlayer==='black'&&displayHistory.length<reviewFrames.length-1&&isValidMove(displayBoard,x,y,'black',frame.parent?.gameState.board);
              const canPlay=activeTab==='play'&&currentPlayer==='black'&&!finished&&!isAiThinking&&!showReview;
              return <g key={`${x}-${y}`}>
                {marked>=0 && <circle cx={cx} cy={cy} r={displayStoneRadius+1} fill="none" stroke={selected?'#d87948':'#2c8757'} strokeWidth={displaySize===19?1.7:3} strokeDasharray={selected?'0':'4 3'}/>}
                {activeTab==='play'&&(overlayMode==='danger'||overlayMode==='liberty')&&markers.danger.has(`${x},${y}`)&&<circle cx={cx} cy={cy} r={displayStoneRadius+3.5} fill="#f2b8a8" fillOpacity=".46" stroke="#c94a35" strokeWidth="2.5"/>}
                {activeTab==='play'&&(overlayMode==='danger'||overlayMode==='liberty')&&markers.liberties.has(`${x},${y}`)&&<circle cx={cx} cy={cy} r={displayStoneRadius*.88} fill="#f7e287" stroke="#c08d22" strokeWidth="2"/>}
                {activeTab==='play'&&overlayMode==='recommend'&&hintStep>=3&&currentCandidates[0]?.x===x&&currentCandidates[0]?.y===y&&<circle cx={cx} cy={cy} r={displayStoneRadius+4} fill="#9acfae" fillOpacity=".55" stroke="#1c8851" strokeWidth="3"/>}
                {viewingReview&&reviewGuess?.x===x&&reviewGuess?.y===y&&<circle cx={cx} cy={cy} r={displayStoneRadius} fill="#468961" fillOpacity=".65" stroke="#1e7142" strokeWidth="2"/>}
                {stone&&<circle cx={cx} cy={cy} r={displayStoneRadius} className={stone==='black'?'ew-piece-b':'ew-piece-w'}/>}
                {marked>=0&&<g><circle cx={cx+displayStoneRadius*.7} cy={cy-displayStoneRadius*.7} r={Math.max(4.2,displayStoneRadius*.5)} fill="#3b805b" stroke="#f0efe5" strokeWidth=".7"/><text x={cx+displayStoneRadius*.7} y={cy-displayStoneRadius*.7+2.3} fontSize={Math.max(5.2,displayStoneRadius*.58)} fill="#fff" fontWeight="bold" textAnchor="middle">{marked+1}</text></g>}
                {atLast&&stone&&<circle cx={cx} cy={cy} r={Math.max(2,displayStoneRadius*.24)} fill={stone==='black'?'#f5f5ef':'#5a735e'}/>}
                {(canPlay||canReviewGuess)&&<circle className="ew-click" cx={cx} cy={cy} r={displayHitRadius} fill="transparent" role="button" tabIndex={0} aria-label={`${spot(x,y,displaySize)}에 ${canPlay?'흑돌 놓기':'복기 연습 자리 선택'}`} onClick={()=>{if(canPlay)play(x,y);else setReviewGuess({x,y});}} onKeyDown={(e:{key:string;preventDefault:()=>void})=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(canPlay)play(x,y);else setReviewGuess({x,y});}}}/>}
              </g>;
            }))}
          </svg>
        </div>
      </div>

      </>}
      {activeTab==='play'&&<>
      <div className="ew-toolbar" role="group" aria-label="바둑 대국 조작">
        <div className="ew-toolbar-main" role="group" aria-label="첫 번째 줄: 백 응수, 패스, 무르기">
          <button type="button" className="ew-tool ew-tool-primary" disabled={finished||showReview||currentPlayer!=='white'||isAiThinking||busyMove} onClick={whiteReply}>{isAiThinking?'⚪ 생각 중…':'⚪ 백 응수 두기'}</button>
          <button type="button" className="ew-tool" disabled={finished||showReview||currentPlayer!=='black'} onClick={()=>useGameStore.getState().passTurn()}>패스</button>
          <button type="button" className="ew-tool" disabled={finished||!currentNode.parent||isAiThinking} onClick={undoTurn}>↶ 무르기</button>
        </div>
      </div>

      <section className="ew-card ew-coachcard" aria-label="오늘의 한 수"><div className="ew-cardtop"><div className="ew-cardheading"><span className="ew-icon">✦</span>오늘의 한 수</div><span className="ew-badge">{!lastBlack?'첫 착수':coaching.loss===null?'살펴보는 중':coaching.loss<=.7?'좋은 선택':coaching.loss<=2.5?'괜찮은 선택':coaching.loss<=5?'더 좋은 수 있음':'중요한 수 놓침'}</span></div>
        <p className="ew-title-explain">{lastBlack?`${spot(lastBlack.move!.x,lastBlack.move!.y,boardSize)} 수를 살펴볼게.`:'첫 수를 두면 바로 알려 줄게!'}</p>
        <div className="ew-lessonbox"><div className="ew-lessonlabel">▤ 선생님의 조언</div>{lastBlack&&<strong className="ew-judgment">{coaching.title}</strong>}<p>{lastBlack?coaching.detail:'첫 수를 둬 봐. 내 돌이 안전한지부터 차근차근 알려 줄게.'}</p>{coaching.facts.slice(0,1).map((f,i)=><div className="ew-fact" key={i}>· {f}</div>)}</div>
        <div className="ew-coachactions"><button type="button" className="ew-expandbtn" onClick={()=>setExtraCoaching(v=>!v)}>{extraCoaching?'설명 접기':'자세한 이유'} ▾</button><button type="button" className="ew-expandbtn" aria-pressed={overlayMode==='danger'||overlayMode==='liberty'} onClick={()=>{setOverlayMode(m=>m==='danger'?'none':'danger');window.scrollTo({top:0,behavior:'smooth'});}}>🔴 위험한 돌</button><button type="button" className="ew-expandbtn" aria-expanded={showHintPanel} onClick={()=>setShowHintPanel(v=>!v)}>💡 {showHintPanel?'힌트 접기':'힌트 받기'}</button></div>
        {whitePassed&&<p className="ew-whitepass"><strong>⚪ 백이 패스했어.</strong> 지금 둘 만한 곳이 없다고 판단했을 수 있어. 하지만 연습용 작은 모델이 너무 일찍 패스하는 경우도 있으니, 아직 둘 곳이 보이면 흑돌을 계속 둬도 돼. 양쪽이 연속으로 패스하면 대국이 끝나.</p>}
        <div className="ew-parttitle"><span>⚫ 이번 흑 차례 추천 자리</span><small>먼저 이유를 알아보자</small></div>
        <div className="ew-picks">{suggestions.length?suggestions.map((o,i)=><button type="button" key={`${o.x}-${o.y}`} className={`ew-pick ${highlight===`${o.x},${o.y}`?'ew-active':''}`} onClick={()=>{setHighlight(`${o.x},${o.y}`);setShowSuggestions(true);}}>{i+1}순위 {spot(o.x,o.y,boardSize)} · 왜?</button>):<span className="ew-muted">{currentPlayer==='white'?'지금은 백 차례야. 백이 응수하면 새로운 흑 차례의 추천 자리를 보여 줄게.':'현재 판을 분석하고 있어. 흑돌을 놓을 곳을 고르기 전에 아래 질문부터 생각해 봐.'}</span>}</div>
        {suggestions.length>0&&!selectedCandidate&&<p className="ew-muted">흑돌을 놓기 전의 <strong>현재 바둑판</strong>에서 추천한 후보야. 자리를 누르면 왜 좋은지 눈으로 확인할 수 있어.</p>}
        {selectedCandidate&&<WhyThisMove key={`${currentNode.id}:${selectedCandidate.x},${selectedCandidate.y}`} board={board} previous={currentNode.parent?.gameState.board} candidate={selectedCandidate} rank={suggestions.indexOf(selectedCandidate)+1}/>}
        <div className="ew-deeper" style={{marginTop:9,marginBottom:8}}><strong>🧠 어디에 둘지 모르겠다면?</strong><p>① 단수에 걸린 <strong>내 돌</strong>이 있는지 → ② 바로 잡을 수 있는 <strong>백돌</strong>이 있는지 → ③ 내 돌이 <strong>끊길 자리</strong>가 있는지 → ④ 모두 급하지 않다면 빈 공간의 <strong>귀·변</strong>부터 비교해 봐.</p><p>이 순서는 연습용 확인 순서야. 실제로 어느 수가 가장 좋은지는 전체 바둑판에 따라 달라져.</p></div>
        {extraCoaching&&<div className="ew-deeper">{coaching.facts.slice(1).map((f,i)=><p key={i}>· {f}</p>)}{weakest?`지금 흑돌 무리 중 빠져나갈 곳이 ${weakest.liberties.length}개뿐인 곳이 있어. 빨간 동그라미가 그 돌이고, 노란 자리가 빈 곳이야. 위험해지는 순간을 직접 확인해 보자.`:'현재는 활로가 두 개 이하인 흑돌 무리를 찾지 못했어. 계속 다른 흑돌과 연결되는지 살펴봐.'}</div>}
        {showHintPanel&&<div className="ew-hintbox"><div className="ew-hinthead"><strong>💡 놓기 전 힌트</strong><span>정답부터 보지 않고 단계별로!</span></div>
          {currentPlayer==='white'?<p>지금은 백 차례야. 백 응수 버튼을 누르면 다음 흑 차례에서 힌트를 받을 수 있어.</p>:finished?<p>이 판은 끝났어. 복기 탭에서 중요한 장면을 다시 풀어 봐.</p>:<>
          {hintStep===0?<p>어려우면 힌트를 하나씩 열어 봐.</p>:hintStep===1?<p>① {weakest?'잡히기 쉬운 흑돌이 있는지 먼저 살펴봐.':'지금 판에서 어디에 두면 돌이 안전하게 이어질지 살펴봐.'}</p>:hintStep===2?<p>② {weakest?`빨간 돌 주위에 노란 빈자리 ${weakest.liberties.length}곳이 보여? 막히면 잡힐 수 있어.`:'주변에 있는 내 돌과 상대 돌을 각각 확인해 봐. 서로 얼마나 떨어졌는지도 살펴봐.'}</p>:<p>③ {currentCandidates[0]?`KataGo의 첫 번째 후보는 ${spot(currentCandidates[0].x,currentCandidates[0].y,boardSize)}야. 초록색 원으로 표시해 뒀어. 다만 작은 모델의 추천은 틀릴 수도 있어.`:'아직 KataGo의 후보가 없어. 우선 안전한 돌부터 확인해 보자.'}</p>}
          <div className="ew-coachactions"><button type="button" className="ew-hintbtn" onClick={()=>{const next=Math.min(3,hintStep+1);setHintStep(next);setOverlayMode(next===3?'recommend':next===2?'liberty':'none');}} disabled={hintStep>=3}>{hintStep>=3?'힌트 모두 봤어':`${hintStep+1}단계 힌트 보기`}</button><button type="button" className="ew-hintreset" onClick={()=>{setHintStep(0);setOverlayMode('none');setShowHintPanel(false);}}>힌트 닫기</button></div>
          </>}</div>}
        <details className="ew-terms"><summary>📖 바둑 용어 쉽게 배우기 — 귀·변·활로가 뭐야?</summary>
          <div className="ew-term-grid">{(Object.keys(GO_TERMS) as GoTerm[]).map(term=><button type="button" className="ew-term-btn" key={term} aria-pressed={selectedTerm===term} onClick={()=>setSelectedTerm(term)}>{term}</button>)}</div>
          <p className="ew-term-explain"><span className="ew-term-visual" aria-hidden="true">{selectedTerm==='귀'?'◩':selectedTerm==='변'?'▤':selectedTerm==='중앙'?'⊕':'●'}</span><strong>{selectedTerm}</strong> — {GO_TERMS[selectedTerm]}</p>
        </details>
        {isSmallKataGoModel(settings.katagoModelUrl,engineModelName)&&<p className="ew-muted">※ 현재는 연습용 소형 모델이에요. 아래에서 강화 모델을 선택하면 수읽기 품질이 좋아질 수 있어요.</p>}
      </section>

      <div className="ew-aftercoach" aria-label="기타 대국 기능">
        <div className="ew-toolbar-secondary" role="group" aria-label="두 번째 줄: 기권, 새 판, 판 크기">
          <button type="button" className="ew-tool" disabled={finished||showReview} onClick={()=>{if(window.confirm('이 대국을 기권할까요?'))useGameStore.getState().resign('black');}}>기권</button>
          <button type="button" className="ew-tool ew-tool-text" onClick={()=>setConfirmNew(true)}>새 판</button>
          <button type="button" className="ew-tool ew-tool-size" aria-expanded={showBoardSizes} onClick={()=>setShowBoardSizes(b=>!b)}>판 크기 {boardSize}×{boardSize} ▾</button>
        </div>
      {canZoom&&<div className="ew-boardtools"><button type="button" className="ew-zoom" onClick={()=>setBoardZoomed(z=>!z)}>{boardZoomed?'⊟ 판 맞춰 보기':'⊞ 판 확대해서 두기'}</button>{boardZoomed&&<span>← 바둑판을 좌우로 밀어 이동 →</span>}</div>}
      {showBoardSizes&&<div className="ew-size-options" role="group" aria-label="바둑판 줄 수 선택"><strong>판 크기 선택</strong><div className="ew-size-buttons">{([9,13,19] as const).map(n=><button type="button" key={n} className={`ew-size-btn ${n===boardSize?'ew-size-active':''}`} onClick={()=>changeBoardSize(n)} aria-pressed={n===boardSize}>{n}×{n}{n===9?' · 입문':n===13?' · 연습':' · 정규'}</button>)}</div><small>크기를 바꾸면 새 대국으로 시작해. 13줄·19줄은 판을 확대해서 둘 수도 있어.</small></div>}
      </div>

      {finished&&<section className="ew-card" aria-label="대국 결과"><div className="ew-endresult">{autoEnded?`🏁 ${currentNode.endState?.startsWith('B')?'흑':'백'} 승리 · 자동 종료`:endedByResign?'기권으로 대국이 끝났어요':`잠정 결과 · ${score.winner} ${score.margin.toFixed(1)}집 차이`}</div><p className="ew-paragraph">{autoEnded?`포획 차이가 크게 벌어져 연습 대국을 자동 종료했어. 흑은 백돌 ${capturedWhite}개, 백은 흑돌 ${capturedBlack}개를 잡았어. 정식 바둑은 포획 수만으로 승패가 확정되는 것은 아니야.`:endedByResign?'새 판으로 다시 도전해 봐요.':`흑 ${score.black}집 · 백 ${score.white}집(덤 6.5집 포함) · 죽은 돌을 정리하지 않은 잠정 계가예요.`}</p></section>}

      {note&&<div className="ew-notice" role="status">{note}</div>}
      {engineStatus==='error'&&<div className="ew-notice" role="alert">KataGo를 실행할 수 없어요. 인터넷과 모델 설정을 확인해 주세요. {engineError??''}</div>}
      {notification?.type==='error'&&!engineError&&<div className="ew-notice" role="alert">대국 또는 분석 중 문제가 발생했어요. 다시 시도해 주세요.</div>}
      {confirmNew&&<div className="ew-card" role="alertdialog" aria-label="새 판 확인"><strong>현재 대국을 끝내고 새 판으로 시작할까요?</strong><div className="ew-recordbtns" style={{marginTop:12}}><button className="ew-recordbtn" onClick={newGame}>네, 새 판</button><button className="ew-recordbtn" onClick={()=>setConfirmNew(false)}>계속 둘래요</button></div></div>}


      <section className="ew-card" aria-label="선생님에게 물어보기"><div className="ew-cardheading"><span className="ew-icon ew-icon-warm">?</span>선생님에게 물어보기</div>
        <p className="ew-question-desc">“왜 여기 둬야 해?” “내 돌이 위험해?” 같이 물어봐요. 지금 바둑판을 참고해 답해요.</p>
        <form className="ew-form" onSubmit={askCoach}><input className="ew-input" aria-label="바둑 질문" value={askText} onChange={(e:{target:{value:string}})=>setAskText(e.target.value)} maxLength={160} placeholder="이 수가 왜 안 좋은 거야?"/><button type="submit" className="ew-submit" aria-label="질문 보내기" disabled={!askText.trim()}>↑</button></form>
        {askAnswer&&<p className="ew-chatanswer" role="status">💬 {askAnswer}</p>}
        <p className="ew-smallnote">자유 대화형 유료 AI가 아니라, KataGo 평가와 바둑 규칙을 활용한 무료 질문 응답이에요. 답할 수 없는 질문은 그렇게 안내해요.</p>
      </section>

      <div className="ew-go-review"><button type="button" className="ew-go-reviewbtn" onClick={()=>openCurrentReview(true)}>📖 지금까지 둔 수 복기하기 →</button></div>
      <section className="ew-card" aria-label="엔진 설정"><div className="ew-cardheading"><span className="ew-icon">⚙</span>엔진 설정</div><p className="ew-paragraph">강화 모델(약 96MB)은 무료지만 아이폰 Safari에서는 다운로드 차단이나 메모리 부족 등으로 실행이 안 될 수 있어. 오류가 나면 자동으로 가벼운 기본 모델로 돌아가도록 했어.</p>
        {fullModel&&<p className="ew-modelnote">강화 모델을 선택한 상태야. 실제 실행 여부는 위쪽 KataGo 상태를 확인해 줘.</p>}
        {engineStatus==='error'&&<p className="ew-modelnote">실행 오류: {engineError??'알 수 없는 오류'}</p>}
        <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" disabled={fullModel} onClick={stronger}>{fullModel?'강화 모델 선택됨':'강화 모델 시도하기'}</button><button type="button" className="ew-recordbtn" onClick={()=>restoreBasicModel()}>기본 모델로 돌아가기</button></div></section>
      </>}
      {activeTab==='review'&&<>
        {reviewPractice&&<section className="ew-card ew-reviewpractice"><div className="ew-cardheading">🎯 이 장면 다시 두기</div><p className="ew-paragraph">지금 바둑판에서 흑돌을 어디에 두고 싶은지 터치해 봐. <strong>실제 대국 기록은 바뀌지 않아.</strong></p>
          {reviewGuess&&<div className="ew-chatanswer">내가 고른 곳은 {spot(reviewGuess.x,reviewGuess.y,displaySize)}야. {reviewFrames[reviewIndex+1]?.move?.player==='black'?`실제 대국에서는 ${spot(reviewFrames[reviewIndex+1]!.move!.x,reviewFrames[reviewIndex+1]!.move!.y,displaySize)}에 뒀어. `:''}{reviewFrames[reviewIndex]?.analysis?.moves?.[0]?`이 장면의 KataGo 첫 추천은 ${spot(sorted(reviewFrames[reviewIndex]!)[0]!.x,sorted(reviewFrames[reviewIndex]!)[0]!.y,displaySize)}이야.`:'저장된 분석이 없어 어느 수가 더 좋은지는 정확히 비교할 수 없어. 주변 돌의 활로를 먼저 살펴봐.'}</div>}
          <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" onClick={()=>setReviewGuess(null)}>다시 선택</button><button type="button" className="ew-recordbtn" onClick={()=>{setReviewPractice(false);setReviewGuess(null);}}>연습 끝내기</button></div>
        </section>}
        <section className="ew-card ew-reviewlesson"><div className="ew-cardheading">🔎 이 장면을 읽는 법</div>
          {frame?.move? <p className="ew-paragraph">{reviewIndex}번째 수는 {frame.move.player==='black'?'흑':'백'}이 {spot(frame.move.x,frame.move.y,displaySize)}에 {isPass(frame.move)?'패스했어.':'뒀어.'} {frame.move.x>=0?`${partOfBoard(frame.move.x,frame.move.y,displaySize)}에 해당하는 자리야. `:''}{frame.move.x>=0&&frame.gameState.board[frame.move.y]?.[frame.move.x]===frame.move.player?(()=>{const g=getLiberties(frame.gameState.board,frame.move!.x,frame.move!.y);return `지금 이 돌과 연결된 무리가 쓸 수 있는 빈자리는 ${g.liberties}곳이야. ${g.liberties===1?'바로 잡힐 위험이 있으니 눈여겨보자.':''}`;})():''}</p>:<p className="ew-paragraph">대국을 시작하기 전 모습이야. 다음 수를 눌러 어떤 곳부터 두었는지 살펴봐.</p>}
          <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" disabled={reviewFrames.length<2||reviewIndex>=reviewFrames.length-1} onClick={reviewAgain}>✏️ 여기서 다시 둬보기</button><button type="button" className="ew-recordbtn" onClick={()=>openCurrentReview(false)}>현재 대국 불러오기</button></div>
          <p className="ew-smallnote">복기 연습은 원래 대국을 바꾸지 않아. 저장된 기보에는 AI 분석이 없을 수 있으므로 정확한 수의 우열은 단정하지 않아.</p>
        </section>
        <section className="ew-card"><div className="ew-cardheading">📌 주요 장면 바로가기</div><p className="ew-paragraph">대국에서 실제로 돌을 잡았거나 위험해진 순간을 찾아봤어. 눌러서 해당 장면으로 이동해 봐.</p>
          <div className="ew-moments">{reviewHighlights.length?reviewHighlights.map((m,i)=><button type="button" key={`${m.index}-${i}`} className="ew-moment" onClick={()=>reviewJump(m.index)}><strong>{m.label} →</strong><span>{m.detail}</span></button>):<p className="ew-muted">아직 복기할 수가 없어. 대국 탭에서 바둑을 둬 봐.</p>}</div>
        </section>
        <section className="ew-card"><div className="ew-cardheading">📝 이번 대국에서 기억할 세 가지</div>
          <div className="ew-reviewtakeaways"><p><strong>🌟 잘한 점:</strong> {reviewSummary.good}</p><p><strong>🔎 살펴볼 점:</strong> {reviewSummary.caution}</p><p><strong>🎯 다음 판 목표:</strong> {reviewSummary.goal}</p></div>
          <p className="ew-smallnote">위 조언은 실제 포획 기록·활로·저장된 분석을 기준으로 만들었어. 정확한 승부 원인이나 전략적 의도는 단정하지 않아.</p>
        </section>
        <section className="ew-card"><div className="ew-cardheading">🗂️ 복기 자료실</div><p className="ew-paragraph">완료된 대국을 골라 별도로 복기할 수 있어. 선택해도 현재 진행 중인 대국은 그대로 유지돼.</p>
          <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" onClick={saveSgf}>↓ 현재 대국 SGF 저장</button><button type="button" className="ew-recordbtn" onClick={copySgf}>기보 복사</button><button type="button" className="ew-recordbtn" onClick={endReview}>⚫ 대국으로 돌아가기</button></div>
          <div className="ew-divider"/>
          {savedGames.length===0?<p className="ew-muted">아직 저장된 대국이 없어. 대국이 끝나면 여기에 모아 둘게.</p>:savedGames.map(g=><div className="ew-savedentry" key={g.id}><div><div className="ew-saved-title">{g.result} · {g.moves}수</div><div className="ew-saved-description">{g.date}</div></div><button type="button" className="ew-recordbtn" onClick={()=>openSaved(g)}>이 대국 복기</button></div>)}
        </section>
      </>}
      {activeTab==='learn'&&<>
        <ProTsumego/>
        <details className="ew-card" style={{marginTop:11,marginBottom:11}}>
          <summary style={{fontWeight:900,color:'#416c50',cursor:'pointer'}}>🧠 이전 연습 16문제 · 가벼운 복습 (펼치기)</summary>
          <div style={{paddingTop:12}}><AdvancedLessons/></div>
        </details>
        <details className="ew-card" style={{marginTop:10,marginBottom:14}}>
          <summary style={{color:'#436c4b',fontWeight:900,cursor:'pointer',fontSize:14}}>🌱 기초 복습 3문제 (펼치기)</summary>
        <section className="ew-card ew-learnintro" style={{border:0,padding:'12px 0 0',marginTop:0}}><div className="ew-cardheading">🌱 처음부터 차근차근, 바둑 공부방</div><p className="ew-paragraph">어려운 용어를 외우지 않아도 괜찮아. 그림으로 익히고 직접 한 수 골라 보자.</p>
          <div className="ew-progress">오늘의 연습 {dailyDone.length}/3 완료</div>
          <div className="ew-lessonchips">{LESSONS.map((v,i)=><button key={i} type="button" className={lessonIndex===i?'ew-lessonchip ew-lessonchip-active':'ew-lessonchip'} onClick={()=>changeLesson(i)}>{dailyDone.includes(i)?'✓ ':''}{i+1}. {v.title}</button>)}</div>
          <p className="ew-quiztitle">{currentLesson.question}</p>
          <TeachingBoard stones={currentLesson.stones} onPoint={lessonTry} selected={lessonGuess}/>
          {lessonGuess&&<p className={lessonCorrect?'ew-quizgood':'ew-quizretry'} role="status">{lessonCorrect?currentLesson.explanation:'아직 아니야! 바둑돌 바로 옆 빈자리를 살펴보거나, 모서리부터 찾아보자.'}</p>}
          <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" onClick={()=>setLessonGuess(null)}>다시 해보기</button><button type="button" className="ew-recordbtn" onClick={()=>changeLesson((lessonIndex+1)%LESSONS.length)}>{lessonCorrect?'다음 연습 →':'다른 연습 보기 →'}</button></div>
          <p className="ew-smallnote">기초 복습 기록은 이 Safari에만 저장돼.</p>
        </section>
        </details>
        <section className="ew-card"><div className="ew-cardheading">📖 그림으로 보는 바둑 용어</div><p className="ew-paragraph">용어를 누르면 5줄짜리 작은 바둑판으로 예를 볼 수 있어.</p>
          <div className="ew-term-grid">{(Object.keys(GO_TERMS) as GoTerm[]).map(term=><button type="button" className="ew-term-btn" key={term} aria-pressed={selectedTerm===term} onClick={()=>setSelectedTerm(term)}>{term}</button>)}</div>
          <div className="ew-termstudy"><TeachingBoard stones={termExample(selectedTerm).stones} marker={termExample(selectedTerm).marker}/><div><h3>{selectedTerm}</h3><p>{GO_TERMS[selectedTerm]}</p><p className="ew-smallnote">{termExample(selectedTerm).caption}</p></div></div>
        </section>
        <section className="ew-card"><div className="ew-cardheading">🎯 이번에 배울 습관</div><p className="ew-paragraph">① 돌을 놓기 전, 내 돌이 잡히기 직전인지 확인하기<br/>② 집을 넓히기 전에 돌이 끊겼는지 보기<br/>③ 패스는 포기가 아니라 차례를 넘기는 선택이라는 점 기억하기</p><button type="button" className="ew-go-reviewbtn" onClick={()=>goTab('play')}>⚫ 대국에서 연습해 보기 →</button></section>
      </>}
      <footer className="ew-footer">KataGo 기반 바둑 과외 · iPhone 웹앱<br/>첫 실행에는 신경망 모델 파일을 내려받아야 해요.</footer>
    </div>
  </main>;
}

export default App;
