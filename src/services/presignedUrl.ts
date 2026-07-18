import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, isS3Configured, S3_BUCKET } from '../config/s3';
import { logger } from '../utils/logger';

/** Default presigned URL lifetime: 1 hour */
const DEFAULT_EXPIRES_IN = 3600;

/**
 * Generate a presigned download URL for a private S3 object.
 *
 * @param key     The S3 object key stored in the database.
 * @param expiresIn  Seconds until the URL expires (default 3600 = 1 hour).
 * @returns A time-limited HTTPS URL, or `undefined` if S3 is not configured.
 */
export async function getPresignedUrl(
  key: string | undefined | null,
  expiresIn = DEFAULT_EXPIRES_IN,
): Promise<string | undefined> {
  if (!key || !isS3Configured() || !s3Client) return undefined;

  // If the value is already a full URL (legacy Cloudinary or old public S3 link), return it as-is
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key;
  }

  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger.error({ err, key }, 'Failed to generate presigned URL');
    return undefined;
  }
}

// ─── Helpers to sign URL fields inside DB objects ─────────────────────────

/**
 * Takes a plain object and replaces the given dot-path fields with presigned URLs.
 * Mutates and returns the same object for convenience.
 *
 * Example:
 *   await signFields(doctor, ['degreeDetails.documentUrl', 'licenseDetails.documentUrl', 'photoUrl']);
 */
export async function signFields<T extends Record<string, any>>(
  obj: T | null | undefined,
  fields: string[],
): Promise<T | null | undefined> {
  if (!obj) return obj;

  const promises = fields.map(async (path) => {
    const parts = path.split('.');
    let target: any = obj;

    // Navigate to the parent
    for (let i = 0; i < parts.length - 1; i++) {
      target = target?.[parts[i]];
      if (!target) return;
    }

    const lastKey = parts[parts.length - 1];
    const currentValue = target[lastKey];
    if (currentValue && typeof currentValue === 'string') {
      const signed = await getPresignedUrl(currentValue);
      if (signed) target[lastKey] = signed;
    }
  });

  await Promise.all(promises);
  return obj;
}

/**
 * Signs URL fields on each item in an array.
 */
export async function signFieldsArray<T extends Record<string, any>>(
  items: T[],
  fields: string[],
): Promise<T[]> {
  await Promise.all(items.map((item) => signFields(item, fields)));
  return items;
}
