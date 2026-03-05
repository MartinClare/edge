/**
 * Configuration constants for the Axon Vision Safety API
 * Adjust these values as needed for your deployment
 */

/**
 * Maximum file size for uploaded images in megabytes
 * Change this value to adjust the upload limit
 */
export const MAX_FILE_SIZE_MB = 5;

/**
 * Maximum file size in bytes (calculated from MB constant)
 */
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Allowed MIME types for image uploads
 * Only these image formats are accepted
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * Human-readable list of allowed extensions for error messages
 */
export const ALLOWED_EXTENSIONS = 'JPEG, PNG, or WebP';
