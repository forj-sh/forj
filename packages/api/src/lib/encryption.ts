/**
 * Encryption utilities for sensitive data
 *
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(crypto.pbkdf2);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 32; // 256 bits

/**
 * Encrypt a string using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @param encryptionKey - Base64-encoded 256-bit encryption key
 * @returns Base64-encoded encrypted data (format: salt:iv:authTag:ciphertext)
 */
export async function encrypt(plaintext: string, encryptionKey: string): Promise<string> {
  if (!plaintext) {
    throw new Error('Plaintext cannot be empty');
  }

  if (!encryptionKey) {
    throw new Error('Encryption key is required');
  }

  // Decode the base64 encryption key
  const keyBuffer = Buffer.from(encryptionKey, 'base64');

  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 256 bits (32 bytes)');
  }

  // Generate random IV (initialization vector)
  const iv = crypto.randomBytes(IV_LENGTH);

  // Generate random salt (for key derivation)
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Derive key from the provided key and salt using PBKDF2 (async to avoid blocking)
  const derivedKey = await pbkdf2(keyBuffer, salt, 100000, 32, 'sha256');

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);

  // Encrypt the plaintext
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  // Get the authentication tag
  const authTag = cipher.getAuthTag();

  // Combine salt:iv:authTag:ciphertext
  const result = [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext,
  ].join(':');

  return result;
}

/**
 * Decrypt a string using AES-256-GCM
 *
 * @param encrypted - Base64-encoded encrypted data (format: salt:iv:authTag:ciphertext)
 * @param encryptionKey - Base64-encoded 256-bit encryption key
 * @returns Decrypted plaintext string
 */
export async function decrypt(encrypted: string, encryptionKey: string): Promise<string> {
  if (!encrypted) {
    throw new Error('Encrypted data cannot be empty');
  }

  if (!encryptionKey) {
    throw new Error('Encryption key is required');
  }

  // Decode the base64 encryption key
  const keyBuffer = Buffer.from(encryptionKey, 'base64');

  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 256 bits (32 bytes)');
  }

  // Split the encrypted data
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [saltBase64, ivBase64, authTagBase64, ciphertext] = parts;

  // Decode components
  const salt = Buffer.from(saltBase64, 'base64');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  // Derive the same key using the stored salt (async to avoid blocking)
  const derivedKey = await pbkdf2(keyBuffer, salt, 100000, 32, 'sha256');

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  // Decrypt the ciphertext
  let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Generate a random 256-bit encryption key
 *
 * @returns Base64-encoded 256-bit key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Validate that an encryption key is properly formatted
 *
 * @param key - Base64-encoded key to validate
 * @returns true if valid, false otherwise
 */
export function isValidEncryptionKey(key: string): boolean {
  try {
    const keyBuffer = Buffer.from(key, 'base64');
    return keyBuffer.length === 32;
  } catch {
    return false;
  }
}
