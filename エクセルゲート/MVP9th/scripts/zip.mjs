import fs from 'node:fs/promises';
import path from 'node:path';
import { validRelative } from './package.mjs';

// ZIP32, stored entries, UTF-8 names. No executable or OS-specific zip dependency.
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipFolder(folder, destination) {
  const entries = [];
  async function walk(relative = '') {
    for (const entry of (await fs.readdir(path.join(folder, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      validRelative(name);
      if (entry.isSymbolicLink()) throw new Error('ZIP cannot contain symlinks');
      if (entry.isDirectory()) { entries.push({ name: name + '/', bytes: Buffer.alloc(0) }); await walk(name); }
      else if (entry.isFile()) entries.push({ name, bytes: await fs.readFile(path.join(folder, name)) });
      else throw new Error('Unsupported ZIP entry');
    }
  }
  await walk();
  if (entries.length > 65535) throw new Error('Too many ZIP entries');
  const local = [], central = []; let offset = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(path.basename(folder) + '/' + name, 'utf8'), crc = crc32(bytes);
    if (filename.length > 65535 || bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('ZIP32 size exceeded');
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt16LE(0x800,6);
    h.writeUInt16LE(33,12); h.writeUInt32LE(crc,14); h.writeUInt32LE(bytes.length,18); h.writeUInt32LE(bytes.length,22); h.writeUInt16LE(filename.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(0x800,8);
    c.writeUInt16LE(33,14); c.writeUInt32LE(crc,16); c.writeUInt32LE(bytes.length,20); c.writeUInt32LE(bytes.length,24); c.writeUInt16LE(filename.length,28);
    c.writeUInt32LE(name.endsWith('/') ? 16 : 0,38); c.writeUInt32LE(offset,42);
    local.push(h,filename,bytes); central.push(c,filename); offset += h.length + filename.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  if (offset + index.length > 0xffffffff) throw new Error('ZIP32 size exceeded');
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(index.length,12); end.writeUInt32LE(offset,16);
  await fs.writeFile(destination, Buffer.concat([...local,index,end]), { flag: 'wx' });
  return destination;
}
