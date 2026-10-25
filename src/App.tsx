import { Layout } from './components/Layout';
import { PwaInstallBanner } from './components/PwaInstallBanner';
/**
 * 바둑 한 수 · 개인용 한국어 과외 확장
 * Web KaTrain (MIT) 클라이언트의 실제 KataGo 분석을 읽어서 화면에 설명합니다.
 * 외부 AI API, 결제, 데이터 전송은 사용하지 않습니다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from './store/gameStore';
import type { BoardState, CandidateMove, GameNode, Move } from './types';

const ABC = 'ABCDEFGHJKLMNOPQRST';
const at = (x: number, y: number, size: number) => x < 0 || y < 0 ? '패스' : `${ABC[x] ?? '?'}${size - y}`;
const top = (node: GameNode | null): CandidateMove[] =>
  (node?.analysis?.moves ?? []).slice().sort((a, b) => a.order - b.order);
const same = (a: Move | CandidateMove, b: Move | CandidateMove) => a.x === b.x && a.y === b.y;
const range = (x: number, y: number, n: number) => x >= 0 && y >= 0 && x < n && y < n;

function chainInfo(board: BoardState, move: Move) {
  if (!range(move.x, move.y, board.length)) return { liberties: 0, size: 0, cutRisk: false };
  const initial = board[move.y]?.[move.x];
  if (!initial) return { liberties: 0, size: 0, cutRisk: false };
  const seen = new Set<string>();
  const liberties = new Set<string>();
  const queue: [number, number][] = [[move.x, move.y]];
  seen.add(`${move.x},${move.y}`);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const xx = x + dx, yy = y + dy;
      if (!range(xx, yy, board.length)) continue;
      const key = `${xx},${yy}`, stone = board[yy]?.[xx];
      if (stone === null) liberties.add(key);
      else if (stone === initial && !seen.has(key)) { seen.add(key); queue.push([xx, yy]); }
    }
  }
  return { liberties: liberties.size, size: seen.size, cutRisk: liberties.size <= 2 };
}

function lastMoveBy(node: GameNode, player: 'black'|'white'): GameNode | null {
  for (let n: GameNode | null = node; n; n = n.parent) {
    if (n.move?.player === player) return n;
  }
  return null;
}

function engineSummary(blackNode: GameNode | null) {
  if (!blackNode?.move) return { quality: '첫 수를 자유롭게 둬 봐', explanation: '9줄 바둑에서 먼저 귀를 활용해 보는 것도 좋아.', reasons: ['작은 판에서는 귀와 돌의 연결이 중요해.'], loss: null as number|null };
  const move = blackNode.move, parent = blackNode.parent;
  const n = blackNode.gameState.board.length;
  const options = top(parent);
  const best = options[0];
  const actual = options.find(c => same(c, move));
  let loss: number | null = null;
  if (actual && best) {
    if (typeof actual.relativePointsLost === 'number' && Number.isFinite(actual.relativePointsLost))
      loss = Math.max(0, actual.relativePointsLost);
    else if (Number.isFinite(actual.scoreLead) && Number.isFinite(best.scoreLead))
      loss = Math.max(0, best.scoreLead - actual.scoreLead);
  }
  const group = chainInfo(blackNode.gameState.board, move);
  const taken = Math.max(0, blackNode.gameState.capturedWhite - (parent?.gameState.capturedWhite ?? 0));
  const edge = Math.min(move.x, move.y, n - 1 - move.x, n - 1 - move.y);
  const reasons: string[] = [];
  if (taken) reasons.push(`백돌 ${taken}개를 잡았어. 포획에 성공했는지 주변 활로도 확인해 봐.`);
  if (group.liberties === 1) reasons.push(`⚠️ 지금 둔 흑돌 무리의 활로가 단 1개야. 바로 잡힐 수 있으니 단수부터 해결해야 해.`);
  else if (group.liberties === 2) reasons.push(`이 흑돌 무리의 활로가 2개야. 상대가 먼저 공격하면 위험해질 수 있어.`);
  else if (group.liberties >= 3) reasons.push(`흑돌 무리의 활로가 ${group.liberties}개라 당장 단수는 아니야.`);
  if (edge >= 3) reasons.push('중앙은 영향력을 만들지만, 집을 확정하는 데에는 더 많은 돌이 필요해.');
  else if (edge <= 2) reasons.push('귀나 변은 집의 윤곽을 만들기 상대적으로 효율적인 곳이야.');
  let quality = '분석을 기다리는 중';
  let explanation = '현재 KataGo가 분석하지 않은 수야. 분석 결과 없이 좋고 나쁨을 단정하지 않을게.';
  if (loss !== null && best) {
    quality = loss <= 0.6 ? '좋은 선택' : loss <= 2 ? '무난하지만 비교해 볼 수' : loss <= 5 ? '조금 아쉬운 선택' : '중요한 개선이 필요한 선택';
    explanation = loss <= 0.6
      ? `KataGo 상위 후보와 거의 비슷해. 지금 수를 둔 이유를 생각해 보자.`
      : `KataGo 분석 기준 약 ${loss.toFixed(1)}점 손해로 추정돼. ${at(best.x, best.y, n)}도 비교해 보자.`;
  } else if (best) {
    quality = '후보 비교 중';
    explanation = `이번 수의 정확한 점수 차는 계산되지 않았어. KataGo의 최상위 후보는 ${at(best.x, best.y, n)}야.`;
  }
  return { quality, explanation, reasons, loss };
}

function candidateRationale(option: CandidateMove, board: BoardState) {
  const n = board.length;
  if (option.x < 0) return '대국을 마무리할 때 패스가 더 유리하다고 판단한 후보야.';
  let nearbyFriend = 0, nearbyEnemy = 0;
  for (const [dx,dy] of [[-1,0],[1,0],[0,1],[0,-1]]) {
    const x = option.x + dx, y = option.y + dy;
    if (!range(x,y,n)) continue;
    if (board[y][x] === 'black') nearbyFriend++;
    if (board[y][x] === 'white') nearbyEnemy++;
  }
  if (nearbyEnemy && nearbyFriend) return '상대 돌과 접촉할 수 있는 자리야. 연결과 끊김, 단수를 특히 살펴봐.';
  if (nearbyEnemy) return '상대 돌의 근처야. 공격이나 침입의 의미가 있을 수 있어.';
  if (nearbyFriend >= 2) return '내 돌들을 튼튼하게 연결하거나 약점을 보강하는 데 도움이 될 수 있어.';
  if (nearbyFriend) return '내 돌의 모양을 뻗어 나가려는 수야.';
  const dist = Math.min(option.x, option.y, n - 1-option.x, n - 1-option.y);
  if (dist <= 2) return '귀 또는 변을 활용해서 집의 밑그림을 그리기 좋아.';
  return '중앙에서 영향력을 만드는 후보야. 집이 바로 확정되지는 않아.';
}

function SmallCandidates({ options, size, board }: { options: CandidateMove[]; size: number; board: BoardState }) {
  if (!options.length) return null;
  return (
    <div className="bc-choices">
      <div className="bc-label">KataGo가 추천하는 다른 선택</div>
      <div className="bc-mini-board" aria-label="추천 좌표 미니 바둑판">
        <svg viewBox="0 0 120 120" role="img" aria-label="최선 후보 위치 표시">
          {Array.from({ length: size }, (_, i) => {
            const p = 12 + i * 96/(size-1);
            return <g key={i}><line x1={12} x2={108} y1={p} y2={p} stroke="#866849" strokeWidth=".7" /><line x1={p} x2={p} y1={12} y2={108} stroke="#866849" strokeWidth=".7" /></g>;
          })}
          {options.slice(0,3).filter(o=>o.x>=0).map((o,i)=><g key={i}>
            <circle cx={12+o.x*96/(size-1)} cy={12+o.y*96/(size-1)} r="7.5" fill={i===0?'#166534':'#eff6ff'} stroke="#123" strokeWidth="1" />
            <text x={12+o.x*96/(size-1)} y={14.4+o.y*96/(size-1)} textAnchor="middle" fontSize="8" fontWeight="bold" fill={i===0?'white':'#123'}>{i+1}</text>
          </g>)}
        </svg>
      </div>
      <div className="bc-candidates">
        {options.slice(0,3).map((o,i)=><div className="bc-cand" key={`${o.x}-${o.y}`}>
          <strong>{i+1}순위 · {at(o.x,o.y,size)}</strong>
          <span>{candidateRationale(o, board)}</span>
          <small>{o.visits > 0 ? `${o.visits}회 탐색` : '정책 후보'}{Number.isFinite(o.relativePointsLost) ? ` · 최선 대비 ${Math.max(0,o.relativePointsLost ?? 0).toFixed(1)}점` : ''}</small>
        </div>)}
      </div>
    </div>
  );
}

function KoreanCoach() {
  const currentNode = useGameStore(state => state.currentNode);
  const engineStatus = useGameStore(state => state.engineStatus);
  const engineModelName = useGameStore(state => state.engineModelName);
  const aiColor = useGameStore(state => state.aiColor);
  const isAiThinking = useGameStore(state => state.isAiThinking);
  const treeVersion = useGameStore(state => state.treeVersion);
  const analysisData = useGameStore(state => state.analysisData);
  // Derive per-move visibility instead of setting state synchronously in an effect.
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedMoveId, setDismissedMoveId] = useState<string | null>(null);
  const [question, setQuestion] = useState<{id: string; kind: 'why'|'urgent'|'best'|'eyes'} | null>(null);
  const [strength, setStrength] = useState<'18'|'12'|'7'>('18');
  const lastBlack = useMemo(() => lastMoveBy(currentNode, 'black'), [currentNode, treeVersion, analysisData]);
  const lastWhite = useMemo(() => lastMoveBy(currentNode, 'white'), [currentNode, treeVersion, analysisData]);
  const bestMoves = top(lastBlack?.parent ?? currentNode);
  const review = engineSummary(lastBlack);
  const requested = useRef(new Set<string>());

  const open = manuallyOpen || Boolean(lastBlack && lastBlack.id !== dismissedMoveId);
  const questionKind = question?.id === (lastBlack?.id ?? '') ? question.kind : null;
  const closeCoach = () => { setDismissedMoveId(lastBlack?.id ?? null); setManuallyOpen(false); };
  const toggleCoach = () => { if (open) closeCoach(); else setManuallyOpen(true); };

  // 각 흑 착수 전에 그 국면을 소규모로 분석: 다음 수의 비교 기준을 준비.
  useEffect(() => {
    if (engineStatus !== 'ready' || currentNode.gameState.currentPlayer !== 'black') return;
    if (currentNode.analysis?.moves?.length || requested.current.has(currentNode.id)) return;
    requested.current.add(currentNode.id);
    void useGameStore.getState().runAnalysis({ ifIdle:true, visits:120, maxTimeMs:3500, topK:10 }).catch(() => {
      requested.current.delete(currentNode.id);
    });
  }, [currentNode, engineStatus, treeVersion]);

  const start = (rank: '18'|'12'|'7') => {
    const game = useGameStore.getState();
    game.updateSettings({ aiStrategy:'rank', aiRankKyu:Number(rank), analysisExperience:'coach', defaultBoardSize:9, showCoordinates:true, appLocale:'ko' });
    game.startNewGame({boardSize:9, rules:'chinese', komi:6.5, handicap:0});
    const after = useGameStore.getState();
    if (after.aiColor !== 'white') after.toggleAi('white');
    setStrength(rank);
    setDismissedMoveId(null);
    setManuallyOpen(false);
    setQuestion(null);
  };

  const size = lastBlack?.gameState.board.length ?? currentNode.gameState.board.length;
  const count = currentNode.gameState.moveHistory.length;
  const black = lastBlack?.move;
  const nearBlack = black ? chainInfo(lastBlack!.gameState.board, black) : null;
  const best = bestMoves[0];
  let answer: string | null = null;
  if (questionKind === 'why') answer = lastBlack ? `${review.explanation} ${review.reasons[0] ?? ''}` : '귀에 두는 수를 연습해 보고, 왜 그곳에 둔 건지 스스로 말해 보자.';
  if (questionKind === 'urgent') answer = nearBlack?.liberties === 1
    ? '바로 단수야! 먼저 활로를 늘리거나 상대 돌을 잡아 내 돌을 살릴 방법을 찾아보자.'
    : nearBlack?.liberties === 2
    ? '활로가 2개야. 상대가 먼저 압박하면 위험해질 수 있으니 연결, 도망, 역단수를 살펴보자.'
    : '당장 방금 둔 흑돌에 단수는 없어. 하지만 멀리 떨어진 다른 돌의 약점도 확인해야 해.';
  if (questionKind === 'best') answer = best ? `현재 참고할 가장 유력한 대안은 ${at(best.x,best.y,size)}야. ${candidateRationale(best, lastBlack?.parent?.gameState.board ?? currentNode.gameState.board)} 다만 이건 전역적으로 완벽한 정답을 뜻하지 않아.` : '추천 수가 아직 없어. KataGo 분석을 완료한 뒤 다시 확인해 봐.';
  if (questionKind === 'eyes') answer = '집은 빈 점을 둘러싼 공간이지만, 사활을 보장하는 두 눈과는 달라. 내 돌이 끊어져 있으면 집처럼 보여도 잡힐 수 있어. 눈 두 개가 서로 독립되어 있는지 확인해 봐.';

  return <div className="bc-root" lang="ko">
    <style>{`
      .bc-root{font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;position:relative;z-index:1000;color:#1e2a27}
      .bc-fab{position:fixed;right:16px;bottom:20px;z-index:1001;border:0;border-radius:99px;background:#174d39;color:white;padding:14px 19px;font-weight:800;font-size:15px;box-shadow:0 6px 24px #0003;min-height:48px}
      .bc-drawer{position:fixed;bottom:76px;left:10px;right:10px;z-index:1002;max-width:570px;margin:auto;background:#fffdf9;border:1px solid #b8c8bd;border-radius:19px;box-shadow:0 10px 35px #0004;max-height:66vh;overflow:auto;padding:17px;line-height:1.5}
      .bc-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.bc-sub{font-size:12px;color:#61736e;margin-top:2px}.bc-x{background:#edf2ef;border:0;border-radius:10px;padding:7px 11px;font-size:17px;min-width:40px;min-height:40px}
      .bc-title{font-size:18px;font-weight:900;color:#153d2b}.bc-pill{display:inline-block;background:#e8f4ee;color:#20563e;border-radius:100px;padding:4px 9px;font-size:12px;margin-top:10px;font-weight:700}
      .bc-card{border-radius:12px;background:#f3f7f2;padding:12px;margin-top:11px;font-size:14px}.bc-card p{margin:7px 0}.bc-label{font-size:13px;font-weight:800;color:#2b5642;margin:11px 0 6px}
      .bc-choices{margin-top:10px}.bc-mini-board{width:116px;float:right;margin:0 0 6px 12px;border-radius:8px;background:#eed0a0}.bc-mini-board svg{width:100%;display:block}
      .bc-candidates{display:flex;flex-direction:column;gap:6px}.bc-cand{background:#faf4e8;border:1px solid #eee4cd;border-radius:10px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:3px}.bc-cand strong{font-size:13px}.bc-cand span{color:#4f5c55}.bc-cand small{color:#64756a}
      .bc-quick{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}.bc-quick button{border:1px solid #b8cbbc;background:white;color:#215440;border-radius:99px;padding:8px 10px;font-weight:650;font-size:12px;min-height:38px}
      .bc-reply{clear:both;background:#edf3fb;border-radius:11px;padding:10px;margin-top:12px;font-size:13px;line-height:1.6;color:#253d54}.bc-control{margin-top:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.bc-control select{border:1px solid #ced3cc;border-radius:8px;padding:8px;background:white;color:#172d22;font-size:14px}.bc-control button{background:#174d39;color:white;border:0;border-radius:9px;padding:10px 12px;min-height:41px;font-size:13px;font-weight:700}
      .bc-warning{color:#815c2b;font-size:11px;margin-top:12px}
      @media(min-width:820px){.bc-drawer{left:auto;right:15px;bottom:80px;width:420px;max-height:74vh}}
      @media(prefers-reduced-motion:no-preference){.bc-fab{transition:transform .2s ease}.bc-fab:active{transform:scale(.96)}}
    `}</style>
    <button type="button" className="bc-fab" onClick={toggleCoach} aria-expanded={open} aria-controls="bc-drawer">⚫ 한 수 과외</button>
    {open && <section className="bc-drawer" id="bc-drawer" aria-label="바둑 한 수 한국어 해설" aria-live="polite">
      <div className="bc-head"><div><div className="bc-title">한 수 과외</div><div className="bc-sub">매 수 KataGo 분석을 초보자 눈높이로 설명해요 · 현재 {count}수</div></div><button type="button" className="bc-x" aria-label="과외 창 닫기" onClick={closeCoach}>✕</button></div>
      <div className="bc-pill">{engineStatus === 'ready' ? `KataGo 작동 중${engineModelName?` · ${engineModelName}`:''}` : engineStatus==='loading'?'KataGo 모델 불러오는 중':engineStatus==='error'?'엔진 오류 · 설정 확인':'엔진 준비 중'}</div>
      {lastBlack?.move ? <>
        <div className="bc-label">⚫ 흑의 최근 착수 · {at(lastBlack.move.x,lastBlack.move.y,size)}</div>
        <div className="bc-card"><strong>{review.quality}</strong><p>{review.explanation}</p>{review.reasons.map((t,i)=><p key={i}>• {t}</p>)}</div>
        {bestMoves.length > 0 ? <SmallCandidates options={bestMoves} size={size} board={lastBlack?.parent?.gameState.board ?? currentNode.gameState.board} /> : <p className="bc-card">현재 수 이전 국면의 KataGo 분석 데이터가 아직 없어. 다음 흑 차례부터는 착수 전에 자동으로 후보를 계산해 둘게.</p>}
        {lastWhite?.move && lastBlack && lastWhite.gameState.moveHistory.length > lastBlack.gameState.moveHistory.length && <div className="bc-reply">⚪ 백 최근 수: <strong>{at(lastWhite.move.x,lastWhite.move.y,size)}</strong> · 이제 흑의 약한 돌이 있는지 먼저 확인하고 다음 수를 생각해 보자. <small>(백의 구체적인 의도를 확정하는 해석은 아니야.)</small></div>}
      </> : <div className="bc-card">빈판이야. 아래에서 ‘9줄 새 판’을 눌러 백을 KataGo로 설정하고 시작해 봐. 아직 수를 두지 않았으니 수의 좋고 나쁨을 평가하지 않을게.</div>}
      <div className="bc-quick">
        <button type="button" onClick={()=>setQuestion({id: lastBlack?.id ?? '', kind: 'why'})}>왜 좋은/아쉬운 수야?</button>
        <button type="button" onClick={()=>setQuestion({id: lastBlack?.id ?? '', kind: 'urgent'})}>지금 돌이 위험해?</button>
        <button type="button" onClick={()=>setQuestion({id: lastBlack?.id ?? '', kind: 'best'})}>다른 수는 어디가 좋아?</button>
        <button type="button" onClick={()=>setQuestion({id: lastBlack?.id ?? '', kind: 'eyes'})}>집이랑 두 눈이 뭐야?</button>
      </div>
      {answer && <div className="bc-reply">💬 {answer}</div>}
      <div className="bc-control"><label htmlFor="bc-rank">백 난이도</label><select id="bc-rank" value={strength} onChange={(e: { target: { value: string } })=>setStrength(e.target.value as '18'|'12'|'7')}><option value="18">입문 · 18급</option><option value="12">초급 · 12급</option><option value="7">도전 · 7급</option></select><button type="button" onClick={()=>start(strength)}>9줄 새 판</button></div>
      <div className="bc-warning">분석 결과는 현재 브라우저 모델과 탐색 횟수에 따라 달라져요. 숫자는 KataGo의 추정치이며, 자연어 해설은 무료 규칙 기반 설명이에요. 완전 자유대화형 AI는 포함되어 있지 않아요.{isAiThinking?' 백이 응수를 계산하고 있어요.':''}{aiColor==='white'?' 백 자동 대국이 켜져 있어요.':''}</div>
    </section>}
  </div>;
}

function App() {
  return <><Layout /><KoreanCoach /><PwaInstallBanner /></>;
}
export default App;
