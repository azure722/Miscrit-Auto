import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {settings,targetMatches} from '../lib/model.mjs';
const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('// Native Constants'),source.indexOf('const $='));
test('native rating mapping covers F- through S+ with no invented E grade',()=>{
  const context=vm.createContext({});vm.runInContext(helper,context);
  for(const [value,grade]of [[6,'F-'],[7,'F'],[8,'F+'],[9,'D'],[10,'D+'],[11,'C'],[12,'C+'],[13,'B'],[14,'B+'],[15,'A'],[16,'A+'],[17,'S'],[18,'S+'],[0,'Any grade']])assert.equal(context.ratingLabel(value),grade);
  assert.equal(context.ratingLabel(3),'3/18','legacy numeric thresholds are preserved');
});

test('unifying any-species choices preserves unrestricted saved profiles and graded capture rules',()=>{
  const context=vm.createContext({});vm.runInContext(helper,context);
  const legacy={mode:'capture_any',minRating:18};
  const migrated=context.captureModeSelection(legacy);
  assert.equal(migrated.mode,'capture_rated');assert.equal(migrated.minRating,0);
  assert.equal(legacy.minRating,18,'loading must not mutate saved settings');
  const catalog={species:[{id:1,name:'Selected'},{id:2,name:'Other'}]};
  for(const rating of [6,10,16,17,18])assert.equal(targetMatches({...migrated,names:[]},{mId:2,rating},catalog),true);
  const graded=context.captureModeSelection({mode:'capture_rated',minRating:16});
  assert.equal(graded.minRating,16);
  assert.equal(targetMatches({...graded,names:[]},{mId:2,rating:15},catalog),false);
  assert.equal(targetMatches({...graded,names:[]},{mId:2,rating:16},catalog),true);
  const selected={...context.captureModeSelection({mode:'capture_targeted',minRating:16}),names:['Selected']};
  assert.equal(targetMatches(selected,{mId:2,rating:18},catalog),false);
  assert.equal(targetMatches(selected,{mId:1,rating:16},catalog),true);
});

test('search pacing is bounded and defaults to eight seconds',()=>{
  const catalog={species:[]};assert.equal(settings({},catalog).searchIntervalSeconds,8);
  assert.equal(settings({searchIntervalSeconds:20},catalog).searchIntervalSeconds,20);
  for(const value of [0,2,121,3.5,'10'])assert.throws(()=>settings({searchIntervalSeconds:value},catalog));
});
