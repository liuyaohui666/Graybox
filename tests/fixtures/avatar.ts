import {deflateSync} from 'node:zlib';
export function png(size:number) {
 const chunk=(name:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);let crc=0xffffffff;for(const v of b.subarray(4,-4)){crc^=v;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(size*(size*4+1)))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
