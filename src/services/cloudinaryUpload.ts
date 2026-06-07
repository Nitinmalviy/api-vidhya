import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { logger } from '../utils/logger';

export type CloudinaryFolder = 'doctor-kyc' | 'clinic';

export async function uploadBase64ToCloudinary(
  file: string,
  folder: CloudinaryFolder
): Promise<string | undefined> {
  if (!isCloudinaryConfigured()) {
    logger.warn('Cloudinary is not configured — skipping file upload');
    return undefined;
  }

  const result = await cloudinary.uploader.upload(file, {
    folder,
    resource_type: 'auto',
  });

  return result.secure_url;
}

