import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from './supabase';

const BUCKET = 'listing-images';

/** Longest edge we ever upload. A 4032px iPhone original is ~3MB; this is ~250KB. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;

/**
 * PRIVACY-CRITICAL. Re-encode a picked image to a plain JPEG before it is ever
 * uploaded or handed to an AI function.
 *
 * iOS returns the ORIGINAL file bytes from the photo library (expo-image-picker
 * only re-encodes on its JPEG path; HEIC assets come back untouched), so an
 * iPhone photo still carries its full EXIF — including GPS coordinates of where
 * it was taken. Uploading that to the public listing-images bucket would hand
 * out the seller's exact home location and defeat the entire approx_lat/lng
 * design, which is why `listings.lat/lng` is revoked at the DB level.
 *
 * Re-encoding through ImageManipulator drops all metadata (no EXIF is carried
 * over) and normalizes HEIC -> JPEG, which also fixes photos not rendering on
 * Android/web and cuts upload size by ~10x.
 */
export async function normalizeImageAsset(asset: ImagePickerAsset): Promise<ImagePickerAsset> {
  const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
  const actions: ImageManipulator.Action[] =
    longest > MAX_EDGE
      ? [{ resize: (asset.width ?? 0) >= (asset.height ?? 0) ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
      : [];
  const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return {
    ...asset,
    uri: out.uri,
    width: out.width,
    height: out.height,
    base64: out.base64 ?? undefined,
    mimeType: 'image/jpeg',
    fileName: undefined, // the original name can leak the source file/device
    exif: undefined,
  };
}

/**
 * Pick images from the library and return metadata-stripped JPEGs. Every caller
 * must use this instead of ImagePicker directly — normalizing here (rather than
 * at upload time) also covers the AI paths, which read `asset.base64` straight
 * from the picker and never touch uploadListingImages.
 */
export async function pickImages(opts: { selectionLimit?: number } = {}): Promise<ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: (opts.selectionLimit ?? 1) > 1,
    selectionLimit: opts.selectionLimit ?? 1,
    quality: 1, // quality is applied during normalization instead
    base64: false, // the original's base64 is discarded; we only ship the re-encode
    exif: false,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(normalizeImageAsset));
}

export async function takePhoto(): Promise<ImagePickerAsset | null> {
  const camera = await ImagePicker.getCameraPermissionsAsync();
  const permission = camera.granted ? camera : await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error(permission.canAskAgain === false ? 'CAMERA_RESTRICTED' : 'CAMERA_DENIED');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    base64: false,
    exif: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? normalizeImageAsset(asset) : null;
}

function extFor(asset: ImagePickerAsset): { ext: string; contentType: string } {
  const mime = asset.mimeType ?? 'image/jpeg';
  if (mime.includes('png')) return { ext: 'png', contentType: 'image/png' };
  if (mime.includes('webp')) return { ext: 'webp', contentType: 'image/webp' };
  return { ext: 'jpg', contentType: 'image/jpeg' };
}

/**
 * Upload picked images to Supabase Storage and return their public URLs.
 * Assets MUST come from `pickImages` (or `normalizeImageAsset`) so that no
 * original camera metadata reaches the public bucket. Files are namespaced
 * under the owner's id so the storage RLS owner checks line up.
 */
export async function uploadListingImages(
  userId: string,
  assets: ImagePickerAsset[],
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < assets.length; i++) {
    // Defense in depth: if a caller ever hands us a raw picker asset, normalize
    // it here rather than trusting it.
    const asset =
      assets[i].mimeType === 'image/jpeg' && assets[i].base64
        ? assets[i]
        : await normalizeImageAsset(assets[i]);
    if (!asset.base64) {
      throw new Error('Image is missing base64 data.');
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
