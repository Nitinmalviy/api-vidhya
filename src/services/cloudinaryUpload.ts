import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { AppError } from '../utils/AppError';

export type CloudinaryFolder = 'doctor-kyc' | 'clinic';

export async function uploadBase64ToCloudinary(
  file: string,
  folder: CloudinaryFolder
): Promise<string> {
  if (!isCloudinaryConfigured()) {
    throw new AppError('Cloudinary is not configured', 500);
  }

  const result = await cloudinary.uploader.upload(file, {
    folder,
    resource_type: 'auto',
  });

  return result.secure_url;
}

