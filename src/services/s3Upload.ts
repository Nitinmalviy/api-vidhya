import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, isS3Configured, S3_BUCKET } from '../config/s3';
import { logger } from '../utils/logger';

export type S3Folder = 'doctor-kyc' | 'clinic' | 'profile' | 'health-records' | 'prescriptions';

/** Allowed MIME types per category */
const ALLOWED_MIME: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: ['application/pdf'],
};
const ALL_ALLOWED = [...ALLOWED_MIME.image, ...ALLOWED_MIME.document];

/** Max file sizes in bytes */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_DOC_SIZE = 25 * 1024 * 1024;   // 25 MB

export type S3UploadFailureReason =
  | 'invalid_format' // not a `data:<mime>;base64,...` string
  | 'unsupported_type' // MIME type not in the allow-list
  | 'too_large' // over MAX_IMAGE_SIZE / MAX_DOC_SIZE
  | 'upload_failed'; // S3 rejected the PutObject (network, credentials, ...)

export type S3UploadResult =
  /** Uploaded — `key` is the S3 object key. */
  | { ok: true; key: string; skipped?: undefined }
  /** S3 isn't configured (local dev): the file was validated but not stored. */
  | { ok: true; key: undefined; skipped: 'not_configured' }
  | { ok: false; reason: S3UploadFailureReason };

/**
 * Validate and upload a base64 data-URI, reporting *why* it failed.
 * Use this when a missing file must stop the request (e.g. KYC at sign-up);
 * `uploadBase64ToS3` keeps the old "undefined on any failure" behaviour.
 */
export async function uploadBase64ToS3Detailed(
  file: unknown, // e.g. "data:image/png;base64,iVBORw0KGgo..."
  folder: S3Folder,
): Promise<S3UploadResult> {
  // 1. Parse the data-URI
  // Use [\s\S]+ instead of .+ to allow newlines in the base64 string
  const match = typeof file === 'string' ? file.match(/^data:([A-Za-z-+\/.]+);base64,([\s\S]+)$/) : null;
  if (!match || match.length !== 3) {
    logger.error({ folder }, 'Invalid base64 format for S3 upload');
    return { ok: false, reason: 'invalid_format' };
  }

  const mimeType = match[1];
  const base64Data = match[2];

  // 2. Validate MIME type
  if (!ALL_ALLOWED.includes(mimeType)) {
    logger.error({ mimeType, folder }, 'Unsupported MIME type for S3 upload');
    return { ok: false, reason: 'unsupported_type' };
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) {
    logger.error({ mimeType, folder }, 'Empty file for S3 upload');
    return { ok: false, reason: 'invalid_format' };
  }

  // 3. Validate file size
  const isImage = ALLOWED_MIME.image.includes(mimeType);
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
  if (buffer.length > maxSize) {
    logger.error(
      { size: buffer.length, maxSize, mimeType, folder },
      'File exceeds maximum allowed size for S3 upload',
    );
    return { ok: false, reason: 'too_large' };
  }

  if (!isS3Configured() || !s3Client) {
    logger.warn('S3 is not configured — skipping file upload');
    return { ok: true, key: undefined, skipped: 'not_configured' };
  }

  // 4. Build a unique key
  const ext = mimeType.split('/')[1]?.replace('+xml', '') || 'bin';
  const key = `${folder}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;

  try {
    // 5. Upload — NO public ACL; bucket is private
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Server-side encryption (AES-256) for data at rest
        ServerSideEncryption: 'AES256',
      }),
    );
  } catch (err) {
    logger.error({ err, folder }, 'S3 upload failed');
    return { ok: false, reason: 'upload_failed' };
  }

  // Return the key, NOT a URL
  return { ok: true, key };
}

/**
 * Upload a base64-encoded file to S3.
 *
 * @returns The S3 object **key** (NOT a full URL), or `undefined` if the
 *          file was invalid, too large, S3 isn't configured or the upload
 *          failed. Callers must use `getPresignedUrl(key)` to generate a
 *          time-limited download link.
 */
export async function uploadBase64ToS3(
  file: string, // e.g. "data:image/png;base64,iVBORw0KGgo..."
  folder: S3Folder,
): Promise<string | undefined> {
  try {
    const result = await uploadBase64ToS3Detailed(file, folder);
    return result.ok ? result.key : undefined;
  } catch (err) {
    logger.error({ err, folder }, 'S3 upload failed — continuing without this file');
    return undefined;
  }
}

/**
 * Delete an object from S3 by key.
 * Used to clean up old files when they are replaced.
 */
export async function deleteFromS3(key: string | undefined): Promise<void> {
  if (!key || !isS3Configured() || !s3Client) return;

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );
  } catch (err) {
    // Non-fatal — log and move on
    logger.error({ err, key }, 'Failed to delete S3 object');
  }
}
