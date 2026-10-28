/**
 * Automatically persists unfinished personal-coach games in the current
 * browser. Saves SGF moves and variations, but not huge KataGo analysis arrays.
 */
import {generateSgfFromTree, parseSgf} from './utils/sgf';
import {useGameStore} from './store/gameStore';

const KEY='baduk-coach:current-game:v1';
const MAX_SGF_LENGTH=1_000_000;
export type GameAutosave={version:1;sgf:string;moveCount:number;boardSize:number;savedAt:string;path?:SavedMove[]};
type SavedMove={x:number;y:number;player:'black'|'white'};
export type AutosaveResult={status:'restored'|'empty'|'error';moveCount:number;message:string};

function read():GameAutosave|null{
 const raw=window.localStorage.getItem(KEY);
 if(!raw)return null;
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=='object')throw Error('bad format');
 const s=value as Partial<GameAutosave>;
 if(s.path && (!Array.isArray(s.path)||s.path.length>2000||s.path.some(move=>move===null||typeof move!=='object'||!Number.isInteger(move.x)||!Number.isInteger(move.y)||(move.player!=='black'&&move.player!=='white'))))throw Error('bad path');
 if(s.version!==1||typeof s.sgf!=='string'||s.sgf.length<10||s.sgf.length>MAX_SGF_LENGTH||
    typeof s.moveCount!=='number'||!Number.isSafeInteger(s.moveCount)||s.moveCount<0||s.moveCount>2000||
    typeof s.boardSize!=='number'||![9,13,19].includes(s.boardSize))throw Error('bad format');
 return s as GameAutosave;
}

/** Called once before enabling autosave to avoid erasing the stored session. */
export function restoreCoachGame():AutosaveResult{
 if(typeof window==='undefined')return {status:'empty',moveCount:0,message:''};
 let saved:GameAutosave|null;
 try{saved=read();}
 catch{return {status:'error',moveCount:0,message:'저장된 대국 정보에 접근하지 못했어. 이전 기록은 그대로 남겨 뒀어.'};}
 if(!saved)return {status:'empty',moveCount:0,message:''};
 try{
   const parsed=parseSgf(saved.sgf);
   if(parsed.initialBoard.length!==saved.boardSize)throw Error('board mismatch');
   const s=useGameStore.getState();
   s.loadGame(parsed);
   if(saved.path&&saved.path.length===saved.moveCount){
     let cursor=useGameStore.getState().rootNode;
     for(const m of saved.path){
       const next=cursor.children.find(child=>child.move?.x===m.x&&child.move?.y===m.y&&child.move?.player===m.player);
       if(!next)throw Error('missing branch');
       cursor=next;
     }
     useGameStore.getState().jumpToNode(cursor);
   }else{
     s.navigateToMove(saved.moveCount);
   }
   const loaded=useGameStore.getState();
   if(loaded.moveHistory.length!==saved.moveCount)throw Error('cursor mismatch');
   return {status:'restored',moveCount:loaded.moveHistory.length,message:'지난번 '+loaded.moveHistory.length+'수까지 두었던 '+saved.boardSize+'×'+saved.boardSize+' 대국을 불러왔어.'};
 }catch{
   return {status:'error',moveCount:0,message:'저장된 대국을 복구하지 못했어. 이전 자동 저장은 덮어쓰지 않았어.'};
 }
}

function exportSnapshot():GameAutosave{
 const s=useGameStore.getState();
 const sgf=generateSgfFromTree(s.rootNode,{trainer:{
   saveAnalysis:false,saveMarks:false,saveFeedback:[false,false,false,false,false,false],
   saveCommentsPlayer:{black:false,white:false},
 }});
 if(sgf.length>MAX_SGF_LENGTH)throw Error('too large');
 return {version:1,sgf,moveCount:s.moveHistory.length,boardSize:s.board.length,savedAt:new Date().toISOString(),path:s.moveHistory.map(m=>({x:m.x,y:m.y,player:m.player}))};
}

/** Changes are flushed synchronously, including when Safari closes the page. */
export function startCoachAutosave(onSaved:(ok:boolean,at:string|null)=>void):()=>void{
 if(typeof window==='undefined')return ()=>{};
 let previousKey='';
 let blocked=false;
 const save=()=>{
   try{
     const snapshot=exportSnapshot();
     window.localStorage.setItem(KEY,JSON.stringify(snapshot));
     blocked=false;
     onSaved(true,snapshot.savedAt);
   }catch{
     if(!blocked){blocked=true;onSaved(false,null);}
   }
 };
 const signature=()=>{
   const s=useGameStore.getState();
   return [s.rootNode.id,s.currentNode.id,s.moveHistory.length,s.board.length].join(':');
 };
 previousKey=signature();
 save();
 const unsubscribe=useGameStore.subscribe(()=>{
   const next=signature();
   if(next===previousKey)return;
   previousKey=next;save();
 });
 const saveOnHide=()=>save();
 const saveOnVisibility=()=>{if(document.visibilityState==='hidden')save();};
 window.addEventListener('pagehide',saveOnHide);
 document.addEventListener('visibilitychange',saveOnVisibility);
 return ()=>{
   unsubscribe();
   window.removeEventListener('pagehide',saveOnHide);
   document.removeEventListener('visibilitychange',saveOnVisibility);
 };
}
