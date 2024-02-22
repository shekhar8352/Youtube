import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnClodinary } from "../utils/Cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// METHOD TO GENERATE ACCESS AND REFRESH TOKEN
const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({
            validateBeforeSave: false,
        });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating token");
    }
};

// ROUTE TO REGISTER USER
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

// ROUTE TO LOGIN USER
const loginUser = asyncHandler(async (req, res) => {
    // FETCHING USER DATA FROM REQ BODY
    const { email, username, password } = req.body;
    if (!username && !email) {
        throw new ApiError(400, "Username or Email field is missing");
    }

    // CHECKING IF USER EXIST OR NOT
    const user = await User.findOne({
        $or: [{ email }, { username }],
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // CHECKING FOR VALID PASSWORD
    const passwordValidity = await user.isPasswordCorrect(password);

    if (!passwordValidity) {
        throw new ApiError(401, "Invalid user credentials");
    }

    // CREATING ACCESS AND REFRESH TOKEN
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
        user._id
    );
    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );

    // SENDING COOKIES
    const options = {
        httpOnly: true,
        secure: true,
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken,
                },
                "Login successful"
            )
        );
});

// ROUTE TO LOGOUT USER
const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true,
    };

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "Logged out successfully"));

});

export { registerUser, loginUser, logoutUser };
