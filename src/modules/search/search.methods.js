const User = require("../user/user.model");
const GenRes = require("../../utils/routers/GenRes");

const SearchUserByNameOrEmail = async (req, res) => {
    try {
        console.log
        const { name } = req.query;
        const user = req.user;

        if (!user) {
            const response = GenRes(401, null, { error: "Unauthorized" }, "User not authenticated");
            return res.status(401).json(response);
        }

        if (!name || typeof name !== "string") {
            const response = GenRes(400, null, { error: "Bad Request" }, "Name query parameter is required");
            return res.status(400).json(response);
        }

        const users = await User.find({
            $or: [
                { name: { $regex: name, $options: "i" } },
                { email: { $regex: name, $options: "i" } }
            ],
            _id: { $ne: user._id },
        })
            .select("name _id picture email")
            .lean();

        const response = GenRes(
            200,
            users,
            null,
            "User search completed successfully"
        );
        return res.status(200).json(response);
    } catch (error) {
        const response = GenRes(
            500,
            null,
            { error: error?.message || "Unknown error" },
            error?.message || "Server Error"
        );
        return res.status(500).json(response);
    }
};

module.exports = { SearchUserByNameOrEmail };