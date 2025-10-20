const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
};

// Check if Cloudinary is properly configured
const isCloudinaryConfigured = cloudinaryConfig.cloud_name && 
  cloudinaryConfig.api_key && 
  cloudinaryConfig.api_secret &&
  cloudinaryConfig.cloud_name !== 'your_cloudinary_cloud_name';

if (isCloudinaryConfigured) {
  cloudinary.config(cloudinaryConfig);
} else {
  console.warn('⚠️  Cloudinary not configured. Photo uploads will be disabled.');
  console.warn('   Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
}

class CloudinaryService {
  /**
   * Upload image to Cloudinary
   * @param {string} filePath - Path to the local file
   * @param {string} folder - Cloudinary folder (optional)
   * @param {string} publicId - Custom public ID (optional)
   * @returns {Promise<Object>} Cloudinary upload result
   */
  static async uploadImage(filePath, folder = 'opd-profiles', publicId = null) {
    try {
      // Check if Cloudinary is configured
      if (!isCloudinaryConfigured) {
        return {
          success: false,
          error: 'Cloudinary not configured. Please set up Cloudinary environment variables.'
        };
      }

      const options = {
        folder: folder,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto'
      };

      if (publicId) {
        options.public_id = publicId;
      }

      const result = await cloudinary.uploader.upload(filePath, options);
      
      // Clean up local file after successful upload
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      return {
        success: true,
        url: result.secure_url,
        public_id: result.public_id,
        asset_id: result.asset_id
      };
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload image from buffer (for direct uploads)
   * @param {Buffer} buffer - Image buffer
   * @param {string} folder - Cloudinary folder (optional)
   * @param {string} publicId - Custom public ID (optional)
   * @returns {Promise<Object>} Cloudinary upload result
   */
  static async uploadImageFromBuffer(buffer, folder = 'opd-profiles', publicId = null) {
    try {
      // Check if Cloudinary is configured
      if (!isCloudinaryConfigured) {
        return {
          success: false,
          error: 'Cloudinary not configured. Please set up Cloudinary environment variables.'
        };
      }

      const options = {
        folder: folder,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto'
      };

      if (publicId) {
        options.public_id = publicId;
      }

      const result = await cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) {
          console.error('Cloudinary upload stream error:', error);
          return { success: false, error: error.message };
        }
        return { success: true, url: result.secure_url, public_id: result.public_id };
      });

      buffer.pipe(result);

      return new Promise((resolve, reject) => {
        result.on('end', (uploadResult) => {
          resolve({
            success: true,
            url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            asset_id: uploadResult.asset_id
          });
        });
        result.on('error', (error) => {
          reject({
            success: false,
            error: error.message
          });
        });
      });
    } catch (error) {
      console.error('Cloudinary buffer upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete image from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @returns {Promise<Object>} Deletion result
   */
  static async deleteImage(publicId) {
    try {
      // Check if Cloudinary is configured
      if (!isCloudinaryConfigured) {
        return {
          success: false,
          error: 'Cloudinary not configured. Please set up Cloudinary environment variables.'
        };
      }

      if (!publicId) {
        return { success: false, error: 'Public ID is required' };
      }

      const result = await cloudinary.uploader.destroy(publicId);
      
      return {
        success: result.result === 'ok',
        result: result.result
      };
    } catch (error) {
      console.error('Cloudinary delete error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract public ID from Cloudinary URL
   * @param {string} url - Cloudinary URL
   * @returns {string|null} Public ID or null
   */
  static extractPublicId(url) {
    if (!url || !url.includes('cloudinary.com')) {
      return null;
    }

    try {
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      return filename.split('.')[0];
    } catch (error) {
      console.error('Error extracting public ID:', error);
      return null;
    }
  }

  /**
   * Upload Google Auth profile image
   * @param {string} imageUrl - Google profile image URL
   * @param {string} userId - User ID for unique naming
   * @returns {Promise<Object>} Upload result
   */
  static async uploadGoogleProfileImage(imageUrl, userId) {
    try {
      const publicId = `google-profile-${userId}-${Date.now()}`;
      
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder: 'opd-profiles',
        public_id: publicId,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto'
      });

      return {
        success: true,
        url: result.secure_url,
        public_id: result.public_id,
        asset_id: result.asset_id
      };
    } catch (error) {
      console.error('Google profile image upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Transform image URL for different sizes
   * @param {string} url - Original Cloudinary URL
   * @param {Object} options - Transformation options
   * @returns {string} Transformed URL
   */
  static getTransformedUrl(url, options = {}) {
    if (!url || !url.includes('cloudinary.com')) {
      return url;
    }

    const {
      width = null,
      height = null,
      crop = 'fill',
      quality = 'auto',
      format = 'auto'
    } = options;

    let transformUrl = url;
    
    if (width || height) {
      const transformations = [];
      if (width) transformations.push(`w_${width}`);
      if (height) transformations.push(`h_${height}`);
      if (crop) transformations.push(`c_${crop}`);
      if (quality) transformations.push(`q_${quality}`);
      if (format) transformations.push(`f_${format}`);

      const baseUrl = url.split('/upload/')[0];
      const path = url.split('/upload/')[1];
      transformUrl = `${baseUrl}/upload/${transformations.join(',')}/${path}`;
    }

    return transformUrl;
  }
}

module.exports = CloudinaryService;
