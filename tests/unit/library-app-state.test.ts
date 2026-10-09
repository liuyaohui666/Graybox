import { expect, it } from 'vitest';
import { LibraryNavigation, LatestProfileRefresh } from '../../apps/desktop/src/library-app-state.ts';

it('resets on accepted same-page and cross-page navigation, but preserves selection during blocked navigation', () => {
  const navigation = new LibraryNavigation();
  expect(navigation.accept(false, false, null)).toBe(1);
  expect(navigation.accept(false, false, null)).toBe(2);
  expect(navigation.accept(true, false, null)).toBeNull();
  expect(navigation.accept(false, true, null)).toBeNull();
  expect(navigation.accept(false, false, { busy: false })).toBeNull();
  expect(navigation.accept(true, true, { busy: true }, true)).toBe(3);
});

it('healthy latest refresh clears only the read error and retains write recovery', async () => {
  const refresh = new LatestProfileRefresh();
  let readError = '', writeError = 'ambiguous write';
  const apply = () => { readError = ''; };
  const fail = (error: Error) => { readError = error.message; };
  await refresh.run('p', () => 'p', async () => { throw new Error('offline'); }, apply, fail);
  expect(readError).toBe('offline');
  await refresh.run('p', () => 'p', async () => ['healthy'], apply, fail);
  expect(readError).toBe('');
  expect(writeError).toBe('ambiguous write');
});

it.each(['resolve', 'reject'] as const)('ignores stale %s after newer success', async outcome => {
  const refresh = new LatestProfileRefresh();
  let resolve!: (value: string) => void, reject!: (error: Error) => void;
  const old = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const seen: string[] = [];
  const apply = (value: string) => { seen.push(value); };
  const fail = (error: Error) => { seen.push(error.message); };
  const pending = refresh.run('p', () => 'p', () => old, apply, fail);
  await refresh.run('p', () => 'p', async () => 'new', apply, fail);
  if (outcome === 'resolve') resolve('old'); else reject(new Error('old failure'));
  await pending;
  expect(seen).toEqual(['new']);
});

it('ignores failures and successes after profile changes', async () => {
  const refresh = new LatestProfileRefresh();
  let identity = 'p';
  const seen: string[] = [];
  await refresh.run('p', () => identity, async () => { identity = 'q'; throw new Error('old failure'); }, value => seen.push(value), error => seen.push(error.message));
  identity = 'p';
  await refresh.run('p', () => identity, async () => { identity = 'q'; return 'old'; }, value => seen.push(value), error => seen.push(error.message));
  expect(seen).toEqual([]);
});
it('mutation invalidation prevents an older polling response from overwriting a confirmed agreement',async()=>{
 const reads=new LatestProfileRefresh();let resolve!:(value:boolean)=>void;
 const old=new Promise<boolean>(yes=>{resolve=yes;}),seen:boolean[]=[];
 const pending=reads.run('a:idea:1',()=> 'a:idea:1',()=>old,value=>seen.push(value),()=>{});
 reads.invalidate();seen.push(true);resolve(false);await pending;expect(seen).toEqual([true]);
 await reads.run('a:idea:1',()=> 'a:idea:1',async()=>true,value=>seen.push(value),()=>{});expect(seen).toEqual([true,true]);
});
