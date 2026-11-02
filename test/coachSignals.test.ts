import {describe,expect,it} from 'vitest';
import {estimatedBlackWinChance,findEmergencyThreat} from '../src/coachSignals';
import type {AnalysisResult,BoardState} from '../src/types';

function board(black:string,white:string,n=9):BoardState{
 const cells:BoardState=Array.from({length:n},()=>Array.from({length:n},()=>null));
 for(const [stones,color] of [[black,'black'],[white,'white']] as const)for(const xy of stones.split(' ').filter(Boolean)){
  const x=xy.charCodeAt(0)-65,y=Number(xy.slice(1))-1;
  cells[y]![x]=color;
 }
 return cells;
}
describe('contextual emergency teaching hints',()=>{
 it('warns on an immediately capturable connected black pair, giving the genuine last liberty',()=>{
  const threat=findEmergencyThreat(board('D4 D5','C4 E4 C5 E5 D3'));
  expect(threat?.severity).toBe('atari');
  expect(threat?.stones).toHaveLength(2);
  expect(threat?.liberties).toEqual([{x:3,y:5}]);
 });
 it('does not warn just because a corner stone has only two liberties',()=>{
  expect(findEmergencyThreat(board('A1',''))).toBeNull();
 });
 it('prompts for two-liberty connected stones under contact, without showing an answer',()=>{
  const threat=findEmergencyThreat(board('D4 D5','C4 E4 C5 E5'));
  expect(threat?.severity).toBe('pressure');
  expect(threat?.liberties).toHaveLength(2);
 });
 it('does not warn for two liberties far from White',()=>{
  expect(findEmergencyThreat(board('A1 B1',''))).toBeNull();
 });
});
describe('AI win chance in black perspective',()=>{
 const sample={
  rootWinRate:.683,rootScoreLead:2,rootVisits:100,
  moves:[{x:2,y:2,winRate:.68,scoreLead:2,visits:50,pointsLost:0,order:0}],
  territory:[],
 } as AnalysisResult;
 it('shows a whole-percent black win chance only if KataGo searched the position',()=>{
  expect(estimatedBlackWinChance(sample)).toBe(68);
 });
 it('does not invent a win chance for positions awaiting analysis or invalid estimates',()=>{
  expect(estimatedBlackWinChance(null)).toBeNull();
  expect(estimatedBlackWinChance({...sample,rootWinRate:NaN})).toBeNull();
  expect(estimatedBlackWinChance({...sample,rootVisits:0})).toBeNull();
  expect(estimatedBlackWinChance({...sample,moves:[]})).toBeNull();
 });
});
