import {expect,test} from 'vitest';
import {fileKind,checkFile,demoSandbox} from '../../apps/desktop/src/attachment-model.ts';
test('only supported media and self-contained HTML are accepted',()=>{expect(fileKind('shot.png')).toBe('image');expect(fileKind('clip.mp4')).toBe('video');expect(fileKind('demo.html')).toBe('demo');expect(()=>fileKind('script.svg')).toThrow();expect(()=>fileKind('archive.zip')).toThrow();});
test('file limits differ and never accept empty content',()=>{expect(()=>checkFile('clip.mp4',50*1024*1024+1)).toThrow();expect(()=>checkFile('demo.html',5*1024*1024+1)).toThrow();expect(()=>checkFile('shot.jpg',0)).toThrow();expect(checkFile('shot.png',100)).toBe('image');});
test('demo iframe keeps scripts isolated without same-origin, forms or navigation',()=>{expect(demoSandbox).toBe('allow-scripts');});
