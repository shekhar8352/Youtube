import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_CLOUD_KEY,
    api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
});

const uploadOnClodinary = async (localFilePath) => {
    try {
        if (!localFilePath) {
          console.log("No file path provided");
          return null;
        }
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
        });
        console.log("File is uploaded to Cloudinary", response.url);
        return response;
    } catch (error) {
      fs.unlinkSync(localFilePath);  // Delete local file after error occurs
      return null
    }
};

export { uploadOnClodinary }
