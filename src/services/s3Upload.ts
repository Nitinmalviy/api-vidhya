import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, isS3Configured } from '../config/s3';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type S3Folder = 'doctor-kyc' | 'clinic' | 'profile';

export async function uploadBase64ToS3(
  file: string, // e.g. "data:image/png;base64,iVBORw0KGgo..."
  folder: S3Folder
): Promise<string | undefined> {
  if (!isS3Configured() || !s3Client) {
    logger.warn('S3 is not configured — skipping file upload');
    return undefined;
  }

  try {
    // 1. Parse base64 string
    const match = file.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!match || match.length !== 3) {
      logger.error('Invalid base64 format for S3 upload');
      return undefined;
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 2. Generate a unique key
    const extension = mimeType.split('/')[1] || 'bin';
    const key = `${folder}/${Date.now()}-${Math.floor(Math.random() * 10000)}.${extension}`;

    // 3. Upload to S3
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      // Optional: Set ACL to public-read if the bucket allows it
      // ACL: 'public-read',
    });

    await s3Client.send(command);

    // 4. Return the public URL
    return `https://${env.AWS_S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (err) {
    logger.error({ err, folder }, 'S3 upload failed — continuing without this file');
    return undefined;
  }
}
