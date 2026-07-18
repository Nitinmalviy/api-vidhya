import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

export const isS3Configured = (): boolean =>
  Boolean(env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET_NAME);

export const s3Client = isS3Configured()
  ? new S3Client({
      region: env.AWS_REGION!,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : undefined;
