import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, isS3Configured, S3_BUCKET } from '../config/s3';
import { logger } from '../utils/logger';

export type S3Folder = 'doctor-kyc' | 'clinic' | 'profile' | 'health-records';

/** Allowed MIME types per category */
const ALLOWED_MIME: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: ['application/pdf'],
};
const ALL_ALLOWED = [...ALLOWED_MIME.image, ...ALLOWED_MIME.document];

/** Max file sizes in bytes */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_DOC_SIZE = 25 * 1024 * 1024;   // 25 MB

/**
 * Upload a base64-encoded file to S3.
 *
 * @returns The S3 object **key** (NOT a full URL).
 *          Callers must use `getPresignedUrl(key)` to generate a
 *          time-limited download link.
 */
export async function uploadBase64ToS3(
  file: string, // e.g. "data:image/png;base64,iVBORw0KGgo..."
  folder: S3Folder,
): Promise<string | undefined> {
  if (!isS3Configured() || !s3Client) {
    logger.warn('S3 is not configured — skipping file upload');
    return undefined;
  }

  try {
    // 1. Parse the data-URI
    // Use [\s\S]+ instead of .+ to allow newlines in the base64 string
    const match = file.match(/^data:([A-Za-z-+\/.]+);base64,([\s\S]+)$/);
    if (!match || match.length !== 3) {
      logger.error('Invalid base64 format for S3 upload');
      return undefined;
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 2. Validate MIME type
    if (!ALL_ALLOWED.includes(mimeType)) {
      logger.error({ mimeType }, 'Unsupported MIME type for S3 upload');
      return undefined;
    }

    // 3. Validate file size
    const isImage = ALLOWED_MIME.image.includes(mimeType);
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
    if (buffer.length > maxSize) {
      logger.error(
        { size: buffer.length, maxSize, mimeType },
        'File exceeds maximum allowed size for S3 upload',
      );
      return undefined;
    }

    // 4. Build a unique key
    const ext = mimeType.split('/')[1]?.replace('+xml', '') || 'bin';
    const key = `${folder}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;

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

    // Return the key, NOT a URL
    return key;
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
