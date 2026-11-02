import {getLiberties} from './utils/gameLogic';
import type {AnalysisResult,BoardState} from './types';

export type CoachPoint={x:number;y:number};
export type EmergencyThreat={
 severity:'atari'|'pressure';
 stones:CoachPoint[];
 liberties:CoachPoint[];
 whiteTouches:number;
};
/** Show a rescue prompt only for a concrete tactical danger, not for merely being behind in the AI evaluation. */
export function findEmergencyThreat(board:BoardState):EmergencyThreat|null{
 const n=board.length,seen=new Set<string>();
 const candidates:EmergencyThreat[]=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  if(board[y]?.[x]!=='black'||seen.has(x+','+y))continue;
  const info=getLiberties(board,x,y);
  for(const stone of info.group)seen.add(stone.x+','+stone.y);
  if(info.liberties>2||info.liberties<1)continue;
  const liberties=new Map<string,CoachPoint>();
  let whiteTouches=0;
  for(const stone of info.group)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const px=stone.x+dx,py=stone.y+dy;
   if(px<0||py<0||px>=n||py>=n)continue;
   if(board[py]?.[px]==='white')whiteTouches++;
   else if(board[py]?.[px]===null)liberties.set(px+','+py,{x:px,y:py});
  }
  // Two liberties alone can be normal on the edge; alert only when a substantial group is fighting White.
  if(info.liberties===2&&(info.group.length<2||whiteTouches===0))continue;
  candidates.push({severity:info.liberties===1?'atari':'pressure',stones:info.group,liberties:[...liberties.values()],whiteTouches});
 }
 candidates.sort((a,b)=>(a.severity==='atari'?0:1)-(b.severity==='atari'?0:1)||b.stones.length-a.stones.length||b.whiteTouches-a.whiteTouches);
 return candidates[0]??null;
}
/** Stored KataGo rootWinRate is in Black's perspective; require actual search evidence. */
export function estimatedBlackWinChance(a:AnalysisResult|null|undefined):number|null{
 if(!a||!Number.isFinite(a.rootWinRate)||a.rootWinRate<0||a.rootWinRate>1)return null;
 if(!(a.moves?.length>0)||(a.rootVisits!==undefined&&(!Number.isFinite(a.rootVisits)||a.rootVisits<=0)))return null;
 if(!a.moves.some(m=>Number.isFinite(m.visits)&&m.visits>0))return null;
 return Math.round(a.rootWinRate*100);
}
