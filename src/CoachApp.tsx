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
  if (!blackNode?.move) return {title:'첫 수를 놓아 봐!',detail:'흑돌을 누르면 그 수의 장단점과 더 나은 후보를 설명해 줄게.',facts:[] as string[],loss:null as number|null};
  const move=blackNode.move, parent=blackNode.parent, board=blackNode.gameState.board;
  const options=sorted(parent),best=options[0];
  const actual=options.find(c=>c.x===move.x && c.y===move.y);
  let loss: number|null=null;
  if (actual && best) {
    const relative=actual.relativePointsLost;
    loss=typeof relative==='number' && Number.isFinite(relative)
      ? Math.max(0,relative) : Number.isFinite(best.scoreLead) && Number.isFinite(actual.scoreLead)
      ? Math.max(0,best.scoreLead - actual.scoreLead) : null;
  } else if (best && parent?.analysis && blackNode.analysis) {
    // 두 시점의 흑 관점 예상 점수차. 수 자체를 직접 탐색하지 않은 경우 참고치에 불과하다.
    const guess=parent.analysis.rootScoreLead-blackNode.analysis.rootScoreLead;
    if (Number.isFinite(guess)) loss=Math.max(0,guess);
  }
  const facts:string[]=[];
  const taken=blackNode.gameState.capturedWhite-(parent?.gameState.capturedWhite??0);
  if (taken>0) facts.push(`백돌 ${taken}개를 잡았어. 잘 잡았는지 이어지는 단수도 살펴보자.`);
  const point=board[move.y]?.[move.x];
  if (point==='black') {
    const group=getLiberties(board,move.x,move.y);
    if (group.liberties===1) facts.push('⚠️ 지금 놓은 흑돌 무리가 단수야! 바로 잡힐 수 있어.');
    else if(group.liberties===2) facts.push('활로가 두 개라 상대 공격을 조심해야 해.');
    else facts.push(`연결된 흑돌의 활로는 ${group.liberties}개야. 단수인지 먼저 확인하는 습관이 좋아.`);
  }
  const edge=Math.min(move.x,move.y,board.length-1-move.x,board.length-1-move.y);
  facts.push(edge<=2?'귀와 변은 적은 돌로 공간을 확보하기 좋아.':'중앙에서 돌의 영향력을 만들었어. 집으로 굳히는 계획도 필요해.');
  let title='바둑 모양을 살펴보자';
  let detail='이 수의 손해를 정확히 계산할 만큼의 분석 자료는 아직 없어. 활로와 연결부터 확인하자.';
  if(loss!==null) {
    title=loss<=0.7?'🌟 좋은 수야!':loss<=2.5?'🙂 꽤 괜찮은 선택':loss<=5?'🔎 다른 수도 비교해 보자':'⚠️ 아쉬운 수야';
    detail=loss<=0.7?'KataGo 추천과 거의 비슷한 선택이야. 왜 좋은지 모양을 살펴보자.'
      :`KataGo 평가상 약 ${loss.toFixed(1)}점이 아쉬운 수야. ${best?spot(best.x,best.y,board.length):'추천 수'}와 비교해 보자.`;
  } else if(best) detail=`정확한 점수 차는 확인되지 않았어. KataGo가 먼저 살펴본 후보는 ${spot(best.x,best.y,board.length)}야.`;
  return {title,detail,facts,loss};
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
  const requestKeys=useRef(new Set<string>());
  const initialized=useRef(false);

  useEffect(()=>{
    if(initialized.current)return;
    initialized.current=true;
    document.title='바둑 한 수 · KataGo 과외';
    document.documentElement.lang='ko';
    const s=useGameStore.getState();
    s.updateSettings({appLocale:'ko',defaultBoardSize:9,showCoordinates:true,aiStrategy:'rank',aiRankKyu:12,katagoVisits:180,katagoMaxTimeMs:6500,analysisExperience:'coach'});
    if(s.board.length!==9) s.startNewGame({boardSize:9,komi:6.5,rules:'chinese',handicap:0});
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
    void state.runAnalysis({ifIdle:true,visits:currentPlayer==='black'?160:70,maxTimeMs:currentPlayer==='black'?6500:4000,topK:22}).catch(()=>{requestKeys.current.delete(key);});
  },[currentNode, currentPlayer, isAnalysisMode, settings.katagoModelUrl, treeVersion]);

  const lastBlack=useMemo(()=>lastOf(currentNode,'black'),[currentNode,treeVersion]);
  const lastWhite=useMemo(()=>lastOf(currentNode,'white'),[currentNode,treeVersion]);
  const suggestions=useMemo(()=>sorted(lastBlack?.parent??null).slice(0,3),[lastBlack,treeVersion]);
  const coaching=useMemo(()=>explain(lastBlack),[lastBlack,treeVersion]);
  const latest=moveHistory[moveHistory.length-1];
  const endedByPass=moveHistory.length>=2 && isPass(moveHistory[moveHistory.length-1]) && isPass(moveHistory[moveHistory.length-2]);
  const endedByResign=Boolean(currentNode.endState?.includes('+R'));
  const finished=endedByPass || endedByResign;
  const score=useMemo(()=>scoreChinese(board,6.5),[board]);
  const isReviewing=showReview;

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
    s.startNewGame({boardSize:9,rules:'chinese',komi:6.5,handicap:0});
    if(!useGameStore.getState().isAnalysisMode)useGameStore.getState().toggleAnalysisMode();
    requestKeys.current.clear();
    setNote('');setAskText('');setAskAnswer('');setShowSuggestions(false);setHighlight(null);setShowReview(false);setConfirmNew(false);setBusyMove(false);
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
    if(!store.currentNode.parent || store.isAiThinking)return;
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
      ?`KataGo가 이 자리 직전에 추천한 곳은 ${suggestions.map((p,i)=>`${i+1}순위 ${spot(p.x,p.y)}`).join(', ')}예요. 그곳을 누르면 바둑판에 표시할 수 있어요.`
      :'지금은 비교할 수 있는 KataGo 후보가 없어요. 다음 흑 차례에서 분석이 완료되면 보여 줄게요.';
    else if(/위험|단수|활로|잡히|살려|죽/.test(q)) a=group
      ?`가장 최근에 둔 흑돌 무리는 활로가 ${group.liberties}개예요. ${group.liberties===1?'단수여서 바로 살리는 수가 필요할 수 있어요.':group.liberties===2?'조만간 공격받기 쉬우니 주변 백돌을 주의해 봐요.':'현재 단수는 아니지만 다른 흑돌 무리는 별도로 확인해야 해요.'}`
      :'현재 판에서 최근 흑돌 무리의 활로를 바로 확인할 수 없어요. 주변 빈 교차점부터 살펴봐요.';
    else if(/집|눈|사활/.test(q)) a='집은 상대가 들어오기 어려운 빈 교차점이고, 두 눈은 돌이 잡히지 않도록 하는 독립된 두 공간이에요. 집이 넓어도 두 눈이 없으면 잡힐 수 있어요.';
    else if(/왜|아쉬|좋은|나쁜|실수|평가/.test(q)) a=lastBlack
      ?`${coaching.detail} ${coaching.facts[0]??''}`
      :'아직 흑이 둔 수가 없어요. 바둑판의 교차점을 터치해 첫 수를 둬 봐요.';
    else if(/백|응수|상대|싸움/.test(q)) a=whiteMove&&lastWhiteTurn>lastBlackTurn
      ?`백은 ${spot(whiteMove.x,whiteMove.y)}에 두었어요. 지금은 그 부근의 흑돌 연결과 활로를 확인하는 게 좋아요. 백의 구체적 의도는 단순히 좌표만으로 단정할 수 없어요.`
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
    const result=endedByResign?'기권':`${score.winner} ${score.margin.toFixed(1)}집 승 (잠정)`;
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
      .ew-scoreline{display:flex;justify-content:space-between;gap:8px;margin:13px 0 19px;font-size:12px;color:#718078;align-items:center}.ew-prisoner{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.ew-prisoner strong{font-weight:850}.ew-scoreline-right{font-weight:850;white-space:nowrap}
      .ew-toolbar{display:flex;justify-content:center;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 16px}.ew-tool{appearance:none;background:#fff;border:1px solid #dfe4de;border-radius:12px;min-height:44px;padding:10px 13px;font-size:13px;font-weight:850;color:#4f5d53;cursor:pointer}.ew-tool:disabled{opacity:.38;cursor:default}.ew-tool-text{background:transparent;border-color:transparent;color:#8b7661}.ew-tool:focus-visible,.ew-submit:focus-visible,.ew-pick:focus-visible{outline:3px solid #b1c8bb;outline-offset:2px}
      .ew-readycard{background:var(--softgreen);border:1px solid #83b18d;border-radius:15px;padding:15px 16px;display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:16px}.ew-readycopy{min-width:0;flex:1}.ew-readytitle{font-size:15px;font-weight:900;letter-spacing:-.02em}.ew-readyhint{font-size:12px;line-height:1.35;color:#779080;margin-top:6px}.ew-replybtn{border-radius:99px;min-height:45px;border:1px solid #dfae87;background:#fff;white-space:nowrap;padding:10px 15px;font-size:14px;font-weight:900;color:#222;cursor:pointer}.ew-replybtn:disabled{opacity:.55;cursor:default}
      .ew-card{border:1px solid #e5e4de;background:#fff;border-radius:18px;padding:18px 19px;margin-top:14px;min-width:0}.ew-cardtop{display:flex;justify-content:space-between;align-items:center;gap:8px}.ew-cardheading{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:900;letter-spacing:-.03em;color:#2d3430}.ew-icon{border-radius:10px;background:#eaf0e9;display:flex;align-items:center;justify-content:center;width:31px;height:31px;font-size:18px;color:#4a8662;flex-shrink:0}.ew-icon-warm{background:#f3ecdf;color:#a08659}.ew-icon-blue{background:#eaedf4;color:#657a94}.ew-badge{font-size:12px;color:#76867b;background:#ecf0ec;padding:6px 11px;border-radius:99px;white-space:nowrap;font-weight:700}.ew-title-explain{margin:12px 0 10px;color:#53665c;font-size:14px;line-height:1.65}.ew-lessonbox{background:#f0f5ef;border:1px solid #e1ebdf;border-radius:12px;padding:12px 13px;margin:10px 0}.ew-lessonlabel{color:#457356;font-size:12px;font-weight:850}.ew-lessonbox p{font-size:13px;line-height:1.72;color:#566d5d;margin:8px 0 0}.ew-fact{font-size:12px;line-height:1.55;margin-top:7px;color:#526457}.ew-parttitle{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:14px 0 9px;font-size:12px;font-weight:900;color:#4b7b59}.ew-parttitle small{font-size:11px;color:#a0ada5;font-weight:400}.ew-picks{display:flex;gap:5px;flex-wrap:wrap}.ew-pick{background:#eaf1e8;border:1px solid #d1e2d0;border-radius:10px;min-height:36px;padding:6px 11px;font-size:12px;color:#426947;font-weight:800;cursor:pointer}.ew-pick.ew-active{background:#2b6b49;border-color:#2b6b49;color:#fff}.ew-muted{font-size:11px;color:#9aa7a0;line-height:1.6;margin:9px 0 0}.ew-browntip{font-size:12px;color:#7e8b81;line-height:1.65;margin:6px 0 0}
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
          <div className="ew-mini-line">{finished?'기보와 계가를 확인해 봐요.':showReview?'원하는 수로 돌아가 살펴봐요.':currentPlayer==='white'?'백의 응수를 누르면 이어서 대국할 수 있어요.':'바둑판의 교차점을 터치해 보세요.'}</div>
        </div>
        <label className="ew-preface-level">백의 실력 <select aria-label="백의 실력" value={level} onChange={(e:{target:{value:string}})=>changeLevel(Number(e.target.value) as 18|12|7)}><option value={18}>입문</option><option value={12}>초급</option><option value={7}>도전</option></select></label>
      </div>

      <div className="ew-boardwrap">
        <svg className="ew-board" viewBox="0 0 380 380" role="group" aria-label="9줄 바둑판. 교차점을 터치하여 흑돌을 놓으세요">
          <rect width="380" height="380" fill="#e3bf87"/>
          {Array.from({length:9},(_,i)=>{const p=42+i*36.25;return <g key={`line${i}`} stroke="#8a6b48" strokeWidth="1.1"><line x1={47} x2={337} y1={p} y2={p}/><line x1={47+i*36.25} x2={47+i*36.25} y1={42} y2={332}/></g>;})}
          {[[2,2],[2,6],[4,4],[6,2],[6,6]].map(([x,y])=><circle key={`star${x}${y}`} cx={47+x*36.25} cy={42+y*36.25} r="3.7" fill="#79583b"/>)}
          {Array.from({length:9},(_,i)=><g key={`coord${i}`} fill="#846c50" fontSize="12" textAnchor="middle"><text x="23" y={46+i*36.25}>{9-i}</text><text x={47+i*36.25} y="357">{AXIS[i]}</text></g>)}
          {board.map((row,y)=>row.map((stone,x)=>{
            const cx=47+x*36.25,cy=42+y*36.25;
            const marked=showSuggestions?suggestions.findIndex(o=>o.x===x&&o.y===y):-1;
            const selected=highlight===`${x},${y}`;
            const atLast=latest?.x===x&&latest?.y===y;
            const canPlay=currentPlayer==='black'&&!finished&&!isAiThinking&&!showReview;
            return <g key={`${x}-${y}`}>
              {marked>=0 && <circle cx={cx} cy={cy} r={17} fill="none" stroke={selected?'#d87948':'#2c8757'} strokeWidth={3} strokeDasharray={selected?'0':'4 3'}/>}
              {stone&&<circle cx={cx} cy={cy} r={16.4} className={stone==='black'?'ew-piece-b':'ew-piece-w'}/>}
              {marked>=0&&<g><circle cx={cx+12} cy={cy-11} r="8" fill="#3b805b" stroke="#f0efe5" strokeWidth="1"/><text x={cx+12} y={cy-8} fontSize="10" fill="#fff" fontWeight="bold" textAnchor="middle">{marked+1}</text></g>}
              {atLast&&stone&&<circle cx={cx} cy={cy} r="4" fill={stone==='black'?'#f5f5ef':'#5a735e'}/>}
              {canPlay&&<circle className="ew-click" cx={cx} cy={cy} r="18.2" fill="transparent" role="button" tabIndex={0} aria-label={`${spot(x,y)}에 흑돌 놓기`} onClick={()=>play(x,y)} onKeyDown={(e:{key:string;preventDefault:()=>void})=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();play(x,y);}}}/>}
            </g>;
          }))}
        </svg>
      </div>
      <div className="ew-scoreline"><div className="ew-prisoner"><span><span className="ew-mini-black" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {capturedWhite}</span><span>·</span><span><span className="ew-mini-white" style={{width:14,height:14,verticalAlign:'-2px'}}/> 포획 {capturedBlack}</span></div><span className="ew-scoreline-right">{moveHistory.length}수</span></div>

      <div className="ew-toolbar">
        <button className="ew-tool" disabled={finished||showReview||currentPlayer!=='black'} onClick={()=>useGameStore.getState().passTurn()}>패스</button>
        <button className="ew-tool" disabled={!currentNode.parent||isAiThinking} onClick={undoTurn}>↶ 무르기</button>
        <button className="ew-tool" disabled={finished||showReview} onClick={()=>{if(window.confirm('이 대국을 기권할까요?'))useGameStore.getState().resign('black');}}>기권</button>
        <button className="ew-tool ew-tool-text" onClick={()=>setConfirmNew(true)}>새 판</button>
      </div>
      {note&&<div className="ew-notice" role="status">{note}</div>}
      {engineStatus==='error'&&<div className="ew-notice" role="alert">KataGo를 실행할 수 없어요. 인터넷과 모델 설정을 확인해 주세요. {engineError??''}</div>}
      {notification?.type==='error'&&!engineError&&<div className="ew-notice" role="alert">대국 또는 분석 중 문제가 발생했어요. 다시 시도해 주세요.</div>}
      {confirmNew&&<div className="ew-card" role="alertdialog" aria-label="새 판 확인"><strong>현재 대국을 끝내고 새 판으로 시작할까요?</strong><div className="ew-recordbtns" style={{marginTop:12}}><button className="ew-recordbtn" onClick={newGame}>네, 새 판</button><button className="ew-recordbtn" onClick={()=>setConfirmNew(false)}>계속 둘래요</button></div></div>}
      <div className="ew-readycard" role="status"><div className="ew-readycopy"><div className="ew-readytitle">{finished?'🏁 대국이 끝났어요':showReview?'◀ 기보를 살펴보고 있어요':isAiThinking?'⚪ KataGo가 생각하고 있어요':currentPlayer==='white'?'⚪ 백 차례':'⚫ 흑 차례'}</div><div className="ew-readyhint">{finished?'아래에서 결과를 확인해 주세요.':showReview?'복기를 마치면 마지막 수로 돌아가요.':isAiThinking?'바둑 엔진이 다음 수를 계산하고 있어요.':currentPlayer==='white'?'흑 착수 해설을 읽었다면 백의 응수를 확인해 봐요.':'원하는 교차점을 눌러 흑돌을 놓아 봐요.'}</div></div>
        {currentPlayer==='white'&&!finished&&!showReview?<button type="button" className="ew-replybtn" disabled={isAiThinking||busyMove} onClick={whiteReply}>{isAiThinking?'생각 중…':'백 응수 보기 →'}</button>:showReview?<button type="button" className="ew-replybtn" onClick={endReview}>복기 끝내기</button>:null}
      </div>
      {finished&&<section className="ew-card" aria-label="대국 결과"><div className="ew-endresult">{endedByResign?'기권으로 대국이 끝났어요':`잠정 결과 · ${score.winner} ${score.margin.toFixed(1)}집 차이`}</div><p className="ew-paragraph">{endedByResign?'새 판으로 다시 도전해 봐요.':`흑 ${score.black}집 · 백 ${score.white}집(덤 6.5집 포함) · 죽은 돌을 정리하지 않은 잠정 계가예요.`}</p></section>}

      <section className="ew-card" aria-label="오늘의 한 수"><div className="ew-cardtop"><div className="ew-cardheading"><span className="ew-icon">✦</span>오늘의 한 수</div><span className="ew-badge">{!lastBlack?'첫 착수':coaching.loss===null?'분석 중':coaching.loss<=.7?'좋은 수':coaching.loss<=2.5?'무난한 수':'아쉬운 수'}</span></div>
        <p className="ew-title-explain">{lastBlack&&suggestions[0]&&coaching.loss!==null&&coaching.loss>.7?`${spot(lastBlack.move!.x,lastBlack.move!.y)}보다 ${spot(suggestions[0].x,suggestions[0].y)}도 생각해 볼 수 있어.`:lastBlack?coaching.detail:'바둑판에 첫 수를 두면 나만의 과외가 시작돼요.'}</p>
        <div className="ew-lessonbox"><div className="ew-lessonlabel">▤ AI 선생님의 설명</div><p>{lastBlack?coaching.detail:'흑돌을 두면 KataGo 분석 결과를 바탕으로 좋은 점, 위험한 점, 다른 후보를 알려 줄게요.'}</p>{coaching.facts.slice(0,3).map((f,i)=><div className="ew-fact" key={i}>· {f}</div>)}</div>
        <div className="ew-parttitle"><span>KataGo 추천 자리</span><small>누르면 바둑판에 표시돼요</small></div>
        <div className="ew-picks">{suggestions.length?suggestions.map((o,i)=><button type="button" key={`${o.x}-${o.y}`} className={`ew-pick ${highlight===`${o.x},${o.y}`?'ew-active':''}`} onClick={()=>{setHighlight(`${o.x},${o.y}`);setShowSuggestions(true);window.scrollTo({top:0,behavior:'smooth'});}}>{i+1}순위 {spot(o.x,o.y)}</button>):<span className="ew-muted">{lastBlack?'이번 수 이전의 분석이 없어요. 다음 착수부터 비교해 볼게요.':'KataGo가 후보를 준비 중이에요.'}</span>}</div>
        {suggestions.length>0&&<p className="ew-muted">{highlight&&suggestions.some(o=>`${o.x},${o.y}`===highlight)?moveExplanation(suggestions.find(o=>`${o.x},${o.y}`===highlight)!,lastBlack?.parent?.gameState.board??board):'현재 국면의 대안이에요. 추천 순위는 모델과 탐색량에 따라 달라져요.'}</p>}
        {coaching.loss!==null&&<p className="ew-muted">예상 집 차 변화(참고): 약 {coaching.loss.toFixed(1)}집 · 엔진 추정치</p>}
        {isSmallKataGoModel(settings.katagoModelUrl,engineModelName)&&<p className="ew-muted">※ 현재는 연습용 소형 모델이에요. 아래에서 강화 모델을 선택하면 수읽기 품질이 좋아질 수 있어요.</p>}
      </section>

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
        <details className="ew-detail"><summary>전체 착수 기록 보기</summary><div className="ew-moves">{moveHistory.length?moveHistory.map((m,i)=><span className="ew-movepill" key={i}>{i+1}. {m.player==='black'?'●':'○'} {spot(m.x,m.y)}</span>):<span className="ew-muted">아직 둔 수가 없어요.</span>}</div></details>
      </section>
      <section className="ew-card" aria-label="이전 대국"><div className="ew-cardheading"><span className="ew-icon ew-icon-blue">◴</span>이전 대국</div><p className="ew-paragraph">이 아이폰 브라우저에서 완료한 대국을 저장해 둘 수 있어요.</p>{savedGames.length===0?<p className="ew-muted">저장된 이전 대국이 아직 없어요.</p>:savedGames.map(g=><div className="ew-savedentry" key={g.id}><div><div className="ew-saved-title">{g.result} · {g.moves}수</div><div className="ew-saved-description">{g.date}</div></div><button type="button" className="ew-recordbtn" onClick={()=>openSaved(g)}>복기하기</button></div>)}</section>
      <section className="ew-card" aria-label="엔진 설정"><div className="ew-cardheading"><span className="ew-icon">⚙</span>엔진 설정</div><p className="ew-paragraph">기본 모델은 빠른 화면 테스트용이라 수읽기가 약할 수 있어요. 강화 모델은 약 96MB를 받아오며 아이폰에서 느릴 수 있지만, 추가 이용료는 없어요.</p><button type="button" className="ew-recordbtn" disabled={fullModel} onClick={stronger}>{fullModel?'강화 KataGo 모델 선택됨':'강화 KataGo 모델 사용하기'}</button></section>
      <footer className="ew-footer">KataGo 기반 바둑 과외 · iPhone 웹앱<br/>첫 실행에는 신경망 모델 파일을 내려받아야 해요.</footer>
    </div>
  </main>;
}

export default App;
