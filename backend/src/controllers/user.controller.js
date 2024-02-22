import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnClodinary } from "../utils/Cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async (req, res) => {
    const { username, email, fullName, password } = req.body;

    // CHECKING VALIDATION
    if (fullName === "" || email === "" || password === "" || username === "") {
        throw new ApiError(400, "All fields are compulsory");
    }

    // CHECKING EXISTING USER
    const existingUser = await User.findOne({
        $or: [{ username }, { email }],
    });

    console.log("Existing user: ", existingUser);

    if (existingUser) {
        throw new ApiError(409, "Username or email is already in use");
    }

    // HANDLING IMAGES
    const avatarLocalPath = req.files?.avatar[0]?.path;
    console.log("Image local path", avatarLocalPath);

    let coverImageLocalPath;
    if (
        req.files &&
        Array.isArray(req.files.coverImage) &&
        req.files.coverImage.length > 0
    ) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new ApiError(409, "Avatar file is required");
    }

    // UPLOADING AND FETCHING URL OF IMAGES
    const avatar = await uploadOnClodinary(avatarLocalPath);
    const coverImage = await uploadOnClodinary(coverImageLocalPath);

    if (!avatar) {
        throw new ApiError(409, "Avatar file is required");
    }

    // SAVE THE NEW USER TO DATABASE
    const user = await User.create({
        fullName,
        username: username.toLowerCase(),
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
    });

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );
    console.log("Created user: ", createdUser);
    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering user");
    }

    // SENDING RESPONSE
    return res
        .status(201)
        .json(
            new ApiResponse(200, createdUser, "User registered successfully")
        );
});

export { registerUser };
