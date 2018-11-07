import { Readable } from 'stream'

export function createReadStream(address: string):Readable;
export function downloadFile(address: string, options?):Promise<string>;
export function readFile(address: string, options?):Promise<string>;