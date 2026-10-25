import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useGameStore } from './store/gameStore';
import { getLiberties, isValidMove } from './utils/gameLogic';
import { generateSgfFromTree, parseSgf } from './utils/sgf';
import { KATAGO_RECOMMENDED_MODEL_URL, isSmallKataGoModel } from './engine/katago/modelDefaults';
import type { BoardState, CandidateMove, GameNode, Move } from './types';

type SavedGame = {id:string;date:string;result:string;moves:number;sgf:string};
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
  const [note,setNote]=useState('');
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
  const [boardZoomed,setBoardZoomed]=useState(()=>typeof window!=='undefined'&&window.innerWidth<640&&useGameStore.getState().board.length===19);
  const requestKeys=useRef(new Set<string>());
  const initialized=useRef(false);

  useEffect(()=>{
    if(initialized.current)return;
    initialized.current=true;
    document.title='바둑 한 수 · KataGo 과외';
    document.documentElement.lang='ko';
    const s=useGameStore.getState();
    s.updateSettings({appLocale:'ko',defaultBoardSize:s.board.length===13||s.board.length===19?s.board.length:9,showCoordinates:true,aiStrategy:'rank',aiRankKyu:12,katagoVisits:180,katagoMaxTimeMs:6500,analysisExperience:'coach'});
    if (![9,13,19].includes(s.board.length)) s.startNewGame({boardSize:9,komi:6.5,rules:'chinese',handicap:0});
    const updated=useGameStore.getState();
    if(updated.isAiPlaying && updated.aiColor)updated.toggleAi(updated.aiColor);
    if(!useGameStore.getState().isAnalysisMode) useGameStore.getState().toggleAnalysisMode();
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
  const suggestions=useMemo(()=>sorted(lastBlack?.parent??null).slice(0,3),[lastBlack,treeVersion]);
  const coaching=useMemo(()=>explain(lastBlack),[lastBlack,treeVersion]);
  const latest=moveHistory[moveHistory.length-1];
  const endedByPass=moveHistory.length>=2 && isPass(moveHistory[moveHistory.length-1]) && isPass(moveHistory[moveHistory.length-2]);
  const endedByResign=Boolean(currentNode.endState?.includes('+R'));
  const finished=endedByPass || endedByResign;
  const autoEnded=Boolean(currentNode.note?.startsWith('연습 대국 자동 종료 ·'));
  const score=useMemo(()=>scoreChinese(board,6.5),[board]);
  const isReviewing=showReview;
  const boardSize=board.length;
  const gridGap=290/(boardSize-1);
  const stoneRadius=Math.min(16.4,gridGap*0.45);
  const hitRadius=Math.max(8,gridGap*0.49);
  const starPoints=boardSize===19?[[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]:boardSize===13?[[3,3],[3,9],[6,6],[9,3],[9,9]]:[[2,2],[2,6],[4,4],[6,2],[6,6]];
  const canZoom=boardSize>9;
  const earlyWinner=overwhelmingPracticeWinner(board,moveHistory.length,capturedWhite,capturedBlack);

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

  const fullModel=!isSmallKataGoModel(settings.katagoModelUrl,engineModelName);

  function play(x:number,y:number) {
    const s=useGameStore.getState();
    if(finished || s.currentPlayer!=='black' || s.isAiThinking || isReviewing)return;
    if(!isValidMove(s.board,x,y,'black',s.currentNode.parent?.gameState.board)) {setNote('거기는 둘 수 없는 자리야. 다른 교차점을 눌러 줘.');return;}
    s.playMove(x,y);
    setShowSuggestions(false);setHighlight(null);setNote('');
  }
  function newGame(){
    const s=useGameStore.getState();
    s.startNewGame({boardSize:boardSize as 9|13|19,rules:'chinese',komi:6.5,handicap:0});
    if(!useGameStore.getState().isAnalysisMode)useGameStore.getState().toggleAnalysisMode();
    requestKeys.current.clear();
    setNote('');setAskText('');setAskAnswer('');setShowSuggestions(false);setHighlight(null);setShowReview(false);setConfirmNew(false);setBusyMove(false);setShowBoardSizes(false);
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
    setNote(`${next}×${next} 새 판이야. ${next===19?'교차점을 누르기 쉽게 판을 확대해 뒀어. 좌우로 밀어서 이동할 수 있어.':'흑돌부터 두면 돼.'}`);
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
    if(!window.confirm('더 강한 KataGo 모델(약 96MB)을 받아올까요? 아이폰에서 다운로드·분석이 느릴 수 있어요.'))return;
    useGameStore.getState().updateSettings({katagoModelUrl:KATAGO_RECOMMENDED_MODEL_URL});
    requestKeys.current.clear();setNote('고급 모델을 불러올게. 인터넷 연결이 필요하고 처음에는 시간이 걸릴 수 있어.');
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
  function endReview(){useGameStore.getState().navigateEnd();setShowReview(false);setHighlight(null);}
  async function copySgf(){
    try { await navigator.clipboard.writeText(generateSgfFromTree(useGameStore.getState().rootNode));setNote('기보를 복사했어요.'); }
    catch {setNote('자동 복사가 제한되어 있어요. SGF 저장 버튼을 이용해 주세요.');}
  }
  function openSaved(g: SavedGame){
    try{
      const parsed=parseSgf(g.sgf);
      useGameStore.getState().loadGame(parsed);
      useGameStore.getState().navigateStart();
      setShowReview(true);setNote('이전 대국을 불러왔어요. 아래 복기 버튼으로 한 수씩 살펴보세요.');
      setShowSuggestions(false);setHighlight(null);
    }catch {setNote('저장된 기보를 읽지 못했어요. 다른 대국을 선택해 주세요.');}
  }
  function askCoach(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const q=askText.trim();if(!q)return;
    let a='그 질문은 이 무료 버전에서 정확하게 이해하기 어려워요. ‘왜’, ‘위험’, ‘단수’, ‘집’, ‘추천’, ‘백’, ‘복기’ 같은 말로 다시 물어봐 줘요.';
    const group=lastBlack?.move && board[lastBlack.move.y]?.[lastBlack.move.x]==='black'
      ?getLiberties(board,lastBlack.move.x,lastBlack.move.y):null;
    if(/추천|더 좋|어디|대안|최선/.test(q)) a=suggestions.length
      ?`KataGo가 이 자리 직전에 추천한 곳은 ${suggestions.map((p,i)=>`${i+1}순위 ${spot(p.x,p.y,boardSize)}`).join(', ')}예요. 그곳을 누르면 바둑판에 표시할 수 있어요.`
      :'지금은 비교할 수 있는 KataGo 후보가 없어요. 다음 흑 차례에서 분석이 완료되면 보여 줄게요.';
    else if(/위험|단수|활로|잡히|살려|죽/.test(q)) a=group
      ?`가장 최근에 둔 흑돌 무리는 활로가 ${group.liberties}개예요. ${group.liberties===1?'단수여서 바로 살리는 수가 필요할 수 있어요.':group.liberties===2?'조만간 공격받기 쉬우니 주변 백돌을 주의해 봐요.':'현재 단수는 아니지만 다른 흑돌 무리는 별도로 확인해야 해요.'}`
      :'현재 판에서 최근 흑돌 무리의 활로를 바로 확인할 수 없어요. 주변 빈 교차점부터 살펴봐요.';
    else if(/집|눈|사활/.test(q)) a='집은 상대가 들어오기 어려운 빈 교차점이고, 두 눈은 돌이 잡히지 않도록 하는 독립된 두 공간이에요. 집이 넓어도 두 눈이 없으면 잡힐 수 있어요.';
    else if(/왜|아쉬|좋은|나쁜|실수|평가/.test(q)) a=lastBlack
      ?`${coaching.detail} ${coaching.facts[0]??''}`
      :'아직 흑이 둔 수가 없어요. 바둑판의 교차점을 터치해 첫 수를 둬 봐요.';
    else if(/백|응수|상대|싸움/.test(q)) a=whiteMove&&lastWhiteTurn>lastBlackTurn
      ?`백은 ${spot(whiteMove.x,whiteMove.y,boardSize)}에 두었어요. 지금은 그 부근의 흑돌 연결과 활로를 확인하는 게 좋아요. 백의 구체적 의도는 단순히 좌표만으로 단정할 수 없어요.`
      :'백 응수 버튼을 누르면 KataGo가 실제 탐색으로 수를 선택해요. 해설을 먼저 보고 백을 진행해 봐요.';
    else if(/복기|기보|저장/.test(q)) a='아래 기보·복기에서 ◀ 한 수씩 복기를 누르면 이전 국면으로 이동할 수 있어요. SGF를 저장하면 다른 바둑 앱으로도 기록을 옮길 수 있어요.';
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
      .ew-card{border:1px solid #e5e4de;background:#fff;border-radius:18px;padding:18px 19px;margin-top:14px;min-width:0}.ew-coachcard{margin:0 0 12px;border-color:#d8e4d9}.ew-judgment{display:block;font-size:15px;color:#305c43;margin-top:6px}.ew-cardtop{display:flex;justify-content:space-between;align-items:center;gap:8px}.ew-cardheading{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:900;letter-spacing:-.03em;color:#2d3430}.ew-icon{border-radius:10px;background:#eaf0e9;display:flex;align-items:center;justify-content:center;width:31px;height:31px;font-size:18px;color:#4a8662;flex-shrink:0}.ew-icon-warm{background:#f3ecdf;color:#a08659}.ew-icon-blue{background:#eaedf4;color:#657a94}.ew-badge{font-size:12px;color:#76867b;background:#ecf0ec;padding:6px 11px;border-radius:99px;white-space:nowrap;font-weight:700}.ew-title-explain{margin:12px 0 10px;color:#53665c;font-size:14px;line-height:1.65}.ew-lessonbox{background:#f0f5ef;border:1px solid #e1ebdf;border-radius:12px;padding:12px 13px;margin:10px 0}.ew-lessonlabel{color:#457356;font-size:12px;font-weight:850}.ew-lessonbox p{font-size:13px;line-height:1.72;color:#566d5d;margin:8px 0 0}.ew-fact{font-size:12px;line-height:1.55;margin-top:7px;color:#526457}.ew-parttitle{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:14px 0 9px;font-size:12px;font-weight:900;color:#4b7b59}.ew-parttitle small{font-size:11px;color:#a0ada5;font-weight:400}.ew-picks{display:flex;gap:5px;flex-wrap:wrap}.ew-pick{background:#eaf1e8;border:1px solid #d1e2d0;border-radius:10px;min-height:36px;padding:6px 11px;font-size:12px;color:#426947;font-weight:800;cursor:pointer}.ew-pick.ew-active{background:#2b6b49;border-color:#2b6b49;color:#fff}.ew-muted{font-size:11px;color:#9aa7a0;line-height:1.6;margin:9px 0 0}.ew-browntip{font-size:12px;color:#7e8b81;line-height:1.65;margin:6px 0 0}
      .ew-question-desc{font-size:13px;color:#8a978f;margin:12px 0 13px;line-height:1.65}.ew-form{display:flex;border-radius:13px;background:#f6f7f5;border:1px solid #e1e8e1;padding:5px;gap:6px;align-items:center}.ew-input{border:0;outline:none;background:transparent;font-size:16px;line-height:1.4;padding:10px 7px 10px 9px;flex:1;min-width:0;width:10px;color:#263a2d}.ew-input::placeholder{color:#99a29b}.ew-submit{width:41px;height:41px;border-radius:11px;border:0;background:#99b0a3;color:white;font-size:24px;cursor:pointer;flex-shrink:0}.ew-submit:disabled{opacity:.5;cursor:default}.ew-chatanswer{font-size:13px;line-height:1.6;padding:12px;background:#f0f5ee;border-radius:10px;margin:9px 0 0;color:#355743}.ew-smallnote{font-size:11px;color:#99a69d;margin:11px 0 0;line-height:1.7}
      .ew-paragraph{font-size:13px;line-height:1.7;color:#88988d;margin:11px 0 15px}.ew-recordbtns{display:flex;gap:7px;flex-wrap:wrap}.ew-recordbtn{border:1px solid #dce4db;background:#f8f9f7;color:#5c7162;border-radius:10px;min-height:40px;padding:8px 10px;font-size:12px;font-weight:750;cursor:pointer}.ew-recordbtn:disabled{opacity:.35;cursor:default}.ew-divider{height:1px;background:#eeeee8;margin:14px 0 10px}.ew-detail{color:#6f8176;font-size:12px}.ew-detail summary{cursor:pointer;list-style:none;font-weight:800}.ew-detail summary::before{content:'▸ ';color:#739780}.ew-detail[open] summary::before{content:'▾ '}.ew-moves{display:flex;gap:6px;flex-wrap:wrap;margin:11px 0 0}.ew-movepill{border:1px solid #e2e7df;border-radius:7px;padding:5px 7px;background:#f9faf8;font-size:11px;color:#67786c}.ew-savedentry{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #ecede8}.ew-savedentry:first-child{border-top:none}.ew-saved-title{font-size:12px;font-weight:850;color:#405846}.ew-saved-description{font-size:11px;color:#96a398;margin-top:4px}.ew-endresult{font-size:14px;font-weight:900;color:#286342}.ew-notice{background:#fff3e6;border-radius:10px;padding:10px;color:#8b543c;font-size:12px;line-height:1.5;margin:9px 0}.ew-footer{text-align:center;font-size:10px;color:#afb7ad;padding:21px 8px 8px;line-height:2}
      @media(min-width:700px){.ew-app{padding-top:26px}.ew-wrap{max-width:440px}}@media(max-width:360px){.ew-app{padding-left:12px;padding-right:12px}.ew-replybtn{padding:9px 10px;font-size:12px}.ew-preface-level{font-size:11px}.ew-brandname{font-size:20px}.ew-tool{padding:10px}}
    `}</style>
    <div className="ew-wrap">
      <header className="ew-head">
        <div className="ew-brand"><span className="ew-logo" aria-hidden="true"/><div><div className="ew-kicker">MY GO COACH</div><div className="ew-brandname">바둑 한 수</div></div></div>
        <StatusDot status={engineStatus}/>
      </header>

      <div className="ew-preface">
        <div className="ew-preface-left">
          <div className="ew-turnlabel"><span className="ew-mini-black"/><span className="ew-mini-white"/> {finished?'대국 종료':showReview?'한 수씩 복기 중':currentPlayer==='white'?'백의 응수 확인':'흑 차례 · 착수하기'}</div>
          <div className="ew-mini-line">{finished?'기보와 계가를 확인해 봐요.':showReview?'원하는 수로 돌아가 살펴봐요.':currentPlayer==='white'?'바둑판 바로 아래 ‘백 응수 두기’를 눌러줘요.':'바둑판의 교차점을 터치해 보세요.'}</div>
        </div>
        <label className="ew-preface-level">백의 실력 <select aria-label="백의 실력" value={level} onChange={(e:{target:{value:string}})=>changeLevel(Number(e.target.value) as 18|12|7)}><option value={18}>입문</option><option value={12}>초급</option><option value={7}>도전</option></select></label>
      </div>

      <div className="ew-scoreline"><div className="ew-prisoner"><span><span className="ew-mini-black" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {capturedWhite}</span><span>·</span><span><span className="ew-mini-white" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {capturedBlack}</span></div><span className="ew-scoreline-right">{moveHistory.length}수</span></div>

      <div className="ew-board-area">
        <div className="ew-boardwrap" aria-label={`${boardSize}×${boardSize} 바둑판`}>
          <svg className="ew-board" style={{minWidth:boardZoomed&&canZoom?(boardSize===19?650:510):undefined}} viewBox="0 0 380 380" role="group" aria-label={`${boardSize}줄 바둑판. 교차점을 터치하여 흑돌을 놓으세요`}>
            <rect width="380" height="380" fill="#e3bf87"/>
            {Array.from({length:boardSize},(_,i)=>{const yp=42+i*gridGap,xp=47+i*gridGap;return <g key={`line${i}`} stroke="#8a6b48" strokeWidth={boardSize===19?0.8:1.1}><line x1={47} x2={337} y1={yp} y2={yp}/><line x1={xp} x2={xp} y1={42} y2={332}/></g>;})}
            {starPoints.map(([x,y])=><circle key={`star${x}${y}`} cx={47+x*gridGap} cy={42+y*gridGap} r={boardSize===19?2.2:3.1} fill="#79583b"/>)}
            {Array.from({length:boardSize},(_,i)=><g key={`coord${i}`} fill="#846c50" fontSize={boardSize===19?8.5:boardSize===13?10:12} textAnchor="middle"><text x="23" y={45.5+i*gridGap}>{boardSize-i}</text><text x={47+i*gridGap} y="357">{AXIS[i]}</text></g>)}
            {board.map((row,y)=>row.map((stone,x)=>{
              const cx=47+x*gridGap,cy=42+y*gridGap;
              const marked=showSuggestions?suggestions.findIndex(o=>o.x===x&&o.y===y):-1;
              const selected=highlight===`${x},${y}`;
              const atLast=latest?.x===x&&latest?.y===y;
              const canPlay=currentPlayer==='black'&&!finished&&!isAiThinking&&!showReview;
              return <g key={`${x}-${y}`}>
                {marked>=0 && <circle cx={cx} cy={cy} r={stoneRadius+1} fill="none" stroke={selected?'#d87948':'#2c8757'} strokeWidth={boardSize===19?1.7:3} strokeDasharray={selected?'0':'4 3'}/>}
                {stone&&<circle cx={cx} cy={cy} r={stoneRadius} className={stone==='black'?'ew-piece-b':'ew-piece-w'}/>}
                {marked>=0&&<g><circle cx={cx+stoneRadius*.7} cy={cy-stoneRadius*.7} r={Math.max(4.2,stoneRadius*.5)} fill="#3b805b" stroke="#f0efe5" strokeWidth=".7"/><text x={cx+stoneRadius*.7} y={cy-stoneRadius*.7+2.3} fontSize={Math.max(5.2,stoneRadius*.58)} fill="#fff" fontWeight="bold" textAnchor="middle">{marked+1}</text></g>}
                {atLast&&stone&&<circle cx={cx} cy={cy} r={Math.max(2,stoneRadius*.24)} fill={stone==='black'?'#f5f5ef':'#5a735e'}/>}
                {canPlay&&<circle className="ew-click" cx={cx} cy={cy} r={hitRadius} fill="transparent" role="button" tabIndex={0} aria-label={`${spot(x,y,boardSize)}에 흑돌 놓기`} onClick={()=>play(x,y)} onKeyDown={(e:{key:string;preventDefault:()=>void})=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();play(x,y);}}}/>}
              </g>;
            }))}
          </svg>
        </div>
      </div>

      <div className="ew-toolbar" role="group" aria-label="바둑 대국 조작">
        <div className="ew-toolbar-main" role="group" aria-label="첫 번째 줄: 백 응수, 패스, 기권">
          <button type="button" className="ew-tool ew-tool-primary" disabled={finished||showReview||currentPlayer!=='white'||isAiThinking||busyMove} onClick={whiteReply}>{isAiThinking?'⚪ 생각 중…':'⚪ 백 응수 두기'}</button>
          <button type="button" className="ew-tool" disabled={finished||showReview||currentPlayer!=='black'} onClick={()=>useGameStore.getState().passTurn()}>패스</button>
          <button type="button" className="ew-tool" disabled={finished||showReview} onClick={()=>{if(window.confirm('이 대국을 기권할까요?'))useGameStore.getState().resign('black');}}>기권</button>
        </div>
      </div>

      <section className="ew-card ew-coachcard" aria-label="오늘의 한 수"><div className="ew-cardtop"><div className="ew-cardheading"><span className="ew-icon">✦</span>오늘의 한 수</div><span className="ew-badge">{!lastBlack?'첫 착수':coaching.loss===null?'살펴보는 중':coaching.loss<=.7?'좋은 선택':coaching.loss<=2.5?'괜찮은 선택':coaching.loss<=5?'더 좋은 수 있음':'중요한 수 놓침'}</span></div>
        <p className="ew-title-explain">{lastBlack?`방금 둔 ${spot(lastBlack.move!.x,lastBlack.move!.y,boardSize)}를 함께 복기해 보자.`:'바둑판에 첫 수를 두면 나만의 과외가 시작돼요.'}</p>
        <div className="ew-lessonbox"><div className="ew-lessonlabel">▤ 선생님의 조언</div>{lastBlack&&<strong className="ew-judgment">{coaching.title}</strong>}<p>{lastBlack?coaching.detail:'흑돌을 두면 KataGo 분석 결과를 바탕으로 좋은 점, 위험한 점, 다른 후보를 알려 줄게요.'}</p>{coaching.facts.slice(0,3).map((f,i)=><div className="ew-fact" key={i}>· {f}</div>)}</div>
        <div className="ew-parttitle"><span>KataGo 추천 자리</span><small>누르면 바둑판에 표시돼요</small></div>
        <div className="ew-picks">{suggestions.length?suggestions.map((o,i)=><button type="button" key={`${o.x}-${o.y}`} className={`ew-pick ${highlight===`${o.x},${o.y}`?'ew-active':''}`} onClick={()=>{setHighlight(`${o.x},${o.y}`);setShowSuggestions(true);window.scrollTo({top:0,behavior:'smooth'});}}>{i+1}순위 {spot(o.x,o.y,boardSize)}</button>):<span className="ew-muted">{lastBlack?'이번 수 이전의 분석이 없어요. 다음 착수부터 비교해 볼게요.':'KataGo가 후보를 준비 중이에요.'}</span>}</div>
        {suggestions.length>0&&<p className="ew-muted">{highlight&&suggestions.some(o=>`${o.x},${o.y}`===highlight)?moveExplanation(suggestions.find(o=>`${o.x},${o.y}`===highlight)!,lastBlack?.parent?.gameState.board??board):'현재 국면의 대안이에요. 추천 순위는 모델과 탐색량에 따라 달라져요.'}</p>}
        {isSmallKataGoModel(settings.katagoModelUrl,engineModelName)&&<p className="ew-muted">※ 현재는 연습용 소형 모델이에요. 아래에서 강화 모델을 선택하면 수읽기 품질이 좋아질 수 있어요.</p>}
      </section>

      <div className="ew-aftercoach" aria-label="기타 대국 기능">
        <div className="ew-toolbar-secondary" role="group" aria-label="두 번째 줄: 무르기, 새 판, 판 크기">
          <button type="button" className="ew-tool" disabled={finished||!currentNode.parent||isAiThinking} onClick={undoTurn}>↶ 무르기</button>
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

      <section className="ew-card" aria-label="기보와 복기"><div className="ew-cardheading"><span className="ew-icon ew-icon-blue">≡</span>기보 · 복기</div><p className="ew-paragraph">모든 수가 자동 기록돼요. 대국이 끝나면 한 수씩 돌아보거나 SGF를 내려받을 수 있어요.</p>
        <div className="ew-recordbtns"><button type="button" className="ew-recordbtn" disabled={!currentNode.parent||isAiThinking} onClick={()=>{useGameStore.getState().navigateBack();setShowReview(true);}}>◀ 한 수씩 복기</button><button type="button" className="ew-recordbtn" onClick={saveSgf}>↓ SGF 저장</button><button type="button" className="ew-recordbtn" onClick={copySgf}>기보 복사</button></div>
        {showReview&&<div className="ew-recordbtns" style={{marginTop:8}}><button type="button" className="ew-recordbtn" disabled={!currentNode.parent} onClick={()=>useGameStore.getState().navigateBack()}>◀ 이전 수</button><button type="button" className="ew-recordbtn" disabled={!currentNode.children.length} onClick={()=>useGameStore.getState().navigateForward()}>다음 수 ▶</button><button type="button" className="ew-recordbtn" onClick={endReview}>마지막 수로</button></div>}
        <div className="ew-divider"/>
        <details className="ew-detail"><summary>전체 착수 기록 보기</summary><div className="ew-moves">{moveHistory.length?moveHistory.map((m,i)=><span className="ew-movepill" key={i}>{i+1}. {m.player==='black'?'●':'○'} {spot(m.x,m.y,boardSize)}</span>):<span className="ew-muted">아직 둔 수가 없어요.</span>}</div></details>
      </section>
      <section className="ew-card" aria-label="이전 대국"><div className="ew-cardheading"><span className="ew-icon ew-icon-blue">◴</span>이전 대국</div><p className="ew-paragraph">이 아이폰 브라우저에서 완료한 대국을 저장해 둘 수 있어요.</p>{savedGames.length===0?<p className="ew-muted">저장된 이전 대국이 아직 없어요.</p>:savedGames.map(g=><div className="ew-savedentry" key={g.id}><div><div className="ew-saved-title">{g.result} · {g.moves}수</div><div className="ew-saved-description">{g.date}</div></div><button type="button" className="ew-recordbtn" onClick={()=>openSaved(g)}>복기하기</button></div>)}</section>
      <section className="ew-card" aria-label="엔진 설정"><div className="ew-cardheading"><span className="ew-icon">⚙</span>엔진 설정</div><p className="ew-paragraph">기본 모델은 빠른 화면 테스트용이라 수읽기가 약할 수 있어요. 강화 모델은 약 96MB를 받아오며 아이폰에서 느릴 수 있지만, 추가 이용료는 없어요.</p><button type="button" className="ew-recordbtn" disabled={fullModel} onClick={stronger}>{fullModel?'강화 KataGo 모델 선택됨':'강화 KataGo 모델 사용하기'}</button></section>
      <footer className="ew-footer">KataGo 기반 바둑 과외 · iPhone 웹앱<br/>첫 실행에는 신경망 모델 파일을 내려받아야 해요.</footer>
    </div>
  </main>;
}

export default App;
