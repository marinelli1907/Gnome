import { decode } from 'base64-arraybuffer';
import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from './supabase';

const BUCKET = 'listing-images';

function extFor(asset: ImagePickerAsset): { ext: string; contentType: string } {
  const mime = asset.mimeType ?? 'image/jpeg';
  if (mime.includes('png')) return { ext: 'png', contentType: 'image/png' };
  if (mime.includes('webp')) return { ext: 'webp', contentType: 'image/webp' };
  return { ext: 'jpg', contentType: 'image/jpeg' };
}

/**
 * Upload picked images to Supabase Storage and return their public URLs.
 * Images must be picked with `base64: true`. Files are namespaced under the
 * owner's id so the storage RLS owner checks line up.
 */
export async function uploadListingImages(
  userId: string,
  assets: ImagePickerAsset[],
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    if (!asset.base64) {
      throw new Error('Image is missing base64 data (pick with base64: true).');
    }
    const { ext, contentType } = extFor(asset);
    const path = `${userId}/${Date.now()}-${i}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, decode(asset.base64), { contentType, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}
