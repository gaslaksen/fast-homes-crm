/**
 * Object storage for files the app has to keep: signed agreements, the
 * claimant's ID, the county's form.
 *
 * Railway has no persistent disk, so anything written to the container is
 * gone on the next deploy. This wraps an S3-compatible bucket behind a
 * configured endpoint, which covers AWS S3 and Cloudflare R2 with the same
 * code, and stays deliberately small: put, signed read, delete. Files are
 * never served through the API; a viewer gets a short-lived signed URL and
 * fetches from the bucket directly.
 *
 * Unconfigured is a supported state. `configured()` is false, every write
 * refuses with a plain message, and the rest of the app carries on, so the
 * storage decision does not block the features that only need the
 * document checklist.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';

/** How long a signed download link lives. Long enough to open, not to share. */
const SIGNED_URL_SECONDS = 5 * 60;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(private config: ConfigService) {
    const bucket = (config.get<string>('S3_BUCKET') || '').trim();
    const accessKeyId = (config.get<string>('S3_ACCESS_KEY_ID') || '').trim();
    const secretAccessKey = (config.get<string>('S3_SECRET_ACCESS_KEY') || '').trim();
    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn('S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set. Document upload is disabled.');
      return;
    }
    const endpoint = (config.get<string>('S3_ENDPOINT') || '').trim() || undefined;
    this.bucket = bucket;
    this.client = new S3Client({
      region: (config.get<string>('S3_REGION') || 'us-east-1').trim(),
      endpoint,
      forcePathStyle: String(config.get('S3_FORCE_PATH_STYLE') || '').toLowerCase() === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
    this.logger.log(`Document storage: bucket ${bucket}${endpoint ? ` at ${endpoint}` : ''}`);
  }

  configured(): boolean {
    return !!(this.client && this.bucket);
  }

  /** The client and bucket, or the reason uploads are off as a 400 rather than a 500. */
  private ready(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new BadRequestException(
        'Document storage is not set up. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY on the API.',
      );
    }
    return { client: this.client, bucket: this.bucket };
  }

  /** Reachability check for a settings page. Never throws. */
  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured()) return { ok: false, message: 'Not configured' };
    try {
      await this.client!.send(new HeadBucketCommand({ Bucket: this.bucket! }));
      return { ok: true, message: `Bucket ${this.bucket} reachable` };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Bucket not reachable' };
    }
  }

  /**
   * A key that is unique, sorts by case, and keeps the original name at the
   * end so a bucket listing reads as files and not as hashes.
   */
  keyFor(parts: (string | null | undefined)[], fileName: string): string {
    const safe = String(fileName || 'file')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'file';
    const nonce = randomBytes(6).toString('hex');
    return [...parts.filter(Boolean).map((p) => String(p).replace(/[^A-Za-z0-9._-]+/g, '_')), `${nonce}-${safe}`].join('/');
  }

  async put(key: string, body: Buffer, contentType?: string | null): Promise<void> {
    const { client, bucket } = this.ready();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
      }),
    );
  }

  async signedUrl(key: string, fileName?: string | null): Promise<string> {
    const { client, bucket } = this.ready();
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(fileName ? { ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"` } : {}),
      }),
      { expiresIn: SIGNED_URL_SECONDS },
    );
  }

  /** Best effort: a file already gone is not an error worth failing a delete for. */
  async remove(key: string): Promise<void> {
    if (!this.configured()) return;
    try {
      await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket!, Key: key }));
    } catch (err: any) {
      this.logger.warn(`Could not delete ${key}: ${err?.message}`);
    }
  }
}
