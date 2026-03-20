const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadVideo(filePath, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      public_id: publicId,
      folder: 'noor-edit',
      overwrite: true,
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result.secure_url);
    });
  });
}

module.exports = { uploadVideo };