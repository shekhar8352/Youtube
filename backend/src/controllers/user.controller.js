import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnClodinary } from "../utils/Cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

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
            $unset: {
                refreshToken: 1,
            },
        },
        {
            new: true,
        }
    );

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

// ROUTE TO REFRESH ACCESS TOKEN
const refreshAccessToken = asyncHandler(async (req, res) => {
    // FETCHING INCOMING REFRESH TOKEN FROM THE BODY OF THE REQUEST
    const incomingRefreshToken =
        req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorised request");
    }
    try {
        // VERIFYING THE TOKEN
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        // FETCHING USER FROM THE ID OBTAINED AFTER VERIFIFICATION
        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(401, "Invalid user token");
        }

        // MATCHING INCOMING AND SAVED REFRESH TOKEN
        if (user?.refreshToken != incomingRefreshToken) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        // GENERATING NEW TOKEN
        const options = {
            httpOnly: true,
            secure: true,
        };

        const { accessToken, newRefreshToken } =
            await generateAccessAndRefreshToken(user._id);

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    {
                        accessToken,
                        refreshToken: newRefreshToken,
                    },
                    "Access token refreshed"
                )
            );
    } catch (error) {
        throw new ApiError(401, error?.message || "invalid user token");
    }
});

// ROUTE TO CHANGE USER PASSWORD
const changeCurrentPassword = asyncHandler(async (req, res) => {
    // FETCHING PASSWORDS
    const { oldPassword, newPassword } = req.body;

    // CHECKING IF OLD PASSWORD IS CORRECT OR NOT
    const userId = req.body?._id;
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Old password is incorrect");
    }

    // CHANGING PASSWORD
    user.password = newPassword;
    await user.save({
        validateBeforeSave: false,
    });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Password changed successfully"));
});

// ROUTE TO FETCH USER DETAILS
const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(new ApiResponse(200, req.user, "User fetched successfully"));
});

// ROUTE TO EDIT USER DETAILS
const updateAccountDetails = asyncHandler(async (req, res) => {
    // CHECKING IF ALL THE FIELDS ARE PROVIDED ARE NOT
    const { fullName, email, username } = req.body;

    if (fullName === "" || email === "" || username === "") {
        throw new ApiError(400, "All fields are required");
    }

    // UPDATING THE USER DETAILS
    const userId = req.user?._id;
    const user = await User.findByIdAndUpdate(
        userId,
        {
            $set: {
                fullName: fullName,
                email: email,
                username: username,
            },
        },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(new ApiResponse(200, user, "User details updated successfully"));
});

// ROUTE TO UPDATE AVATAR
const updateUserAvatar = asyncHandler(async (req, res) => {
    // FETCHING THE FILE USING MULTER MIDDLEWARE
    const newAvatarLocalUrl = req.file?.path;

    if (!newAvatarLocalUrl) {
        throw new ApiError(400, "Avatar file is missing");
    }

    // ULOADING TO CLOUDINARY
    const avatar = await uploadOnClodinary(newAvatarLocalUrl);

    if (!avatar.url) {
        throw new ApiError(500, "Error while upoading on cloudinary");
    }

    // UPDATING THE VALUE IN DB
    const userId = req.user?._id;

    const user = await User.findByIdAndUpdateuserId(
        userId,
        {
            $set: {
                avatar: avatar.url,
            },
        },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(new ApiResponse(200, user, "Avatar updated successfully"));
});

// ROUTE TO UPDATE COVER IMAGE
const updateUserCoverIaage = asyncHandler(async (req, res) => {
    // FETCHING THE FILE USING MULTER MIDDLEWARE
    const newCoverImageLocalUrl = req.file?.path;

    if (!newCoverImageLocalUrl) {
        throw new ApiError(400, "Cover image file is missing");
    }

    // ULOADING TO CLOUDINARY
    const coverImage = await uploadOnClodinary(newCoverImageLocalUrl);

    if (!coverImage.url) {
        throw new ApiError(500, "Error while upoading on cloudinary");
    }

    // UPDATING THE VALUE IN DB
    const userId = req.user?._id;

    const user = await User.findByIdAndUpdateuserId(
        userId,
        {
            $set: {
                coverImage: coverImage.url,
            },
        },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(new ApiResponse(200, user, "Cover image updated successfully"));
});

// ROUTE TO FETCH DETAILS OF USER CHANNEL
const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;

    if (!username) {
        throw new ApiError(400, "Username parameter is missing");
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase(),
            },
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers",
            },
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedChannels",
            },
        },
        {
            $addFields: {
                subscriberCount: {
                    $size: "$subscribers",
                },
                subscribedChannelsCount: {
                    $size: "$subscribedChannels",
                },
                isSubscribed: {
                    $cond: {
                        if: {
                            $in: [req.user?._id, "$subscribers.subscriber"],
                        },
                        then: true,
                        else: false,
                    },
                },
            },
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                subscriberCount: 1,
                subscribedChannelsCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
            },
        },
    ]);

    if (!channel?.length) {
        throw new ApiError(404, "Channel not found");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, channel[0], "User channel fetched sucessfully")
        );
});

// ROUTE TO FETCH WATCH HISTORY OF USER
const getUserWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "vedios",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
    .status(200)
    .json(
        new ApiResponse(200, user[0].watchHistory, "Watch history fetched successfully")
    )
});

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverIaage,
    getUserChannelProfile,
    getUserWatchHistory
};
