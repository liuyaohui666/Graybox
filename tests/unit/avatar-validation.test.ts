import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {validAvatar} from '../../packages/core/src/avatar.ts';
import {png} from '../fixtures/avatar.ts';
test('JPEG requires a full scan header and raster bytes after its bounded frame',()=>{
 const jpeg=readFileSync(new URL('../fixtures/avatar-128.jpg',import.meta.url)),scan=jpeg.indexOf(Buffer.from([0xff,0xda]));
 expect(validAvatar('data:image/jpeg;base64,'+jpeg.toString('base64'))).toBe(true);
 const truncated=Buffer.concat([jpeg.subarray(0,scan+4),Buffer.from([0xff,0xd9])]);
 expect(validAvatar('data:image/jpeg;base64,'+truncated.toString('base64'))).toBe(false);
});
test('PNG checks canonical base64, chunk CRC and final terminator',()=>{
 expect(validAvatar(png(128))).toBe(true);const data=Buffer.from(png(128).split(',')[1]!,'base64');data[29]=data[29]!^1;
 expect(validAvatar('data:image/png;base64,'+data.toString('base64'))).toBe(false);
 expect(validAvatar(png(128)+'AAAA')).toBe(false);
});
