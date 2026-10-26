import { createHash, randomBytes, randomUUID as uuid } from 'node:crypto';

export enum CryptoDigestAlgorithm { SHA256 = 'SHA-256' }
export const getRandomBytes = (n: number) => new Uint8Array(randomBytes(n));
export const randomUUID = () => uuid();
export const digestStringAsync = async (_algorithm: CryptoDigestAlgorithm, data: string) => createHash('sha256').update(data).digest('hex');
