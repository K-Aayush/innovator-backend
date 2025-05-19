const path = require("path");
const GenRes = require("../../utils/routers/GenRes");
const Shop = require("./shop.model");
const Cart = require("./cart.model");
const Category = require("./category.model");
const { isValidObjectId } = require("mongoose");
const fs = require("fs");

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const ListShop = async (req, res) => {
  try {
    const query = req?.query?.search;
    const categoryId = req?.query?.category;
    const page = parseInt(req?.params?.page || "0") || 0;
    const fetchLimit = 20;

    const filters = {};

    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    if (query) {
      filters.$or = [
        { name: { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
        { "category.name": { $regex: query, $options: "i" } },
      ];
    }

    if (categoryId) {
      filters["category._id"] = categoryId;
    }

    const recentProducts = await Shop.find(filters)
      .sort({ _id: -1 })
      .skip(page * fetchLimit)
      .limit(fetchLimit)
      .select("-content")
      .lean();

    const mixedProduct = shuffleArray(recentProducts);

    const response = GenRes(
      200,
      mixedProduct,
      null,
      "Responding shuffled & paginated content"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const SingleShop = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id) {
      const response = GenRes(400, null, null, "Missing product id");
      return res.status(400).json(response);
    }

    const filters = { _id };

    // Add vendor check if vendor is making the request
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const data = await Shop.findOne(filters).lean();
    if (!data) {
      const response = GenRes(404, null, null, "No data found");
      return res.status(404).json(response);
    }
    const response = GenRes(200, data, null, "Responding single shop data");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const AddShop = async (req, res) => {
  try {
    console.log("req.body:", req.body);
    console.log("req.files:", req.files);
    console.log("req.file_locations:", req.file_locations);
    console.log("req.vendor:", req.vendor);
    console.log("data.categoryId:", req.body.categoryId);

    const data = req.body;

    if (!data) {
      return res.status(400).json(GenRes(400, null, null, "Missing data"));
    }

    if (!data.categoryId) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Category is required"));
    }

    // Verify category
    const category = await Category.findOne({
      _id: data.categoryId,
      "vendor._id": req.vendor._id,
    });

    console.log("Found category:", category);

    if (!category) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Category not found" }, "Invalid category")
        );
    }

    // Use req.file_locations for image URLs
    const imageUrls = req.file_locations || [];

    // Prepare shop data
    const shopData = {
      name: data.name,
      description: data.description,
      price: Number(data.price),
      stock: Number(data.stock),
      content: data.content,
      images: imageUrls,
      vendor: {
        _id: req.vendor._id,
        email: req.vendor.email,
        businessName: req.vendor.businessName,
      },
      category: {
        _id: category._id.toString(),
        name: category.name,
      },
    };

    const newShop = new Shop(shopData);
    await newShop.save();
    return res.status(201).json(GenRes(201, newShop, null, "New shop added"));
  } catch (error) {
    console.error("Error in AddShop:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const DeleteShop = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id) {
      const response = GenRes(400, null, null, "NO id found");
      return res.status(400).json(response);
    }

    const filters = { _id };

    // Add vendor check if vendor is making the request
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const deleted = await Shop.findOneAndDelete(filters);
    if (!deleted) {
      const response = GenRes(404, null, null, "NO shop found");
      return res.status(404).json(response);
    }

    const failed = [];

    for (const items of deleted?.images) {
      try {
        const imagePath = path.join(process.cwd(), items?.slice(1));
        await fs.promises.unlink(imagePath);
      } catch (error) {
        console.log(error);
        failed.push(items);
      }
    }

    const response = GenRes(200, { failed }, null, "Shop deleted");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const AddToCart = async (req, res) => {
  try {
    const data = req?.body;
    const user = req?.user;

    const updated = await Cart.findOneAndUpdate(
      { product: data?.product, email: user?.email },
      { $set: { ...data, email: user?.email } },
      {
        new: true,
        upsert: true,
      }
    );

    const response = GenRes(200, updated, null, "Added to cart");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const RemoveFromCart = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id || !isValidObjectId(_id)) {
      return res.status(404).json(GenRes(404, null, null, "Invalid"));
    }
    const user = req?.user;
    const cart = await Cart.findOneAndDelete(
      { _id, email: user?.email },
      { new: true }
    );
    if (!cart) {
      return res.status(404).json(GenRes(404, null, null, "Not found"));
    }
    const response = GenRes(200, cart, null, "Removed from cart");
    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const GetCart = async (req, res) => {
  try {
    const email = req?.user?.email;
    const data = await Cart.find({ email }).populate("product");
    const response = GenRes(200, data, null, "Cart");
    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const MultipleFiles = async (req, res) => {
  try {
    const file_locations = req?.file_locations;
    const response = GenRes(
      200,
      file_locations,
      null,
      "Uploaded Successfully!"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const DeleteFiles = async (req, res) => {
  try {
    const filesList = req?.body;
    if (!filesList || !Array.isArray(filesList) || filesList.length === 0) {
      const response = GenRes(
        400,
        null,
        new Error("Files location must be provided in array"),
        "Please provide location in valid format"
      );
      return res.status(400).json(response);
    }

    const failedFile = [];

    for (const file of filesList) {
      try {
        fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
      } catch (error) {
        console.log(error?.message);
        failedFile.push(file);
      }
    }

    const response = GenRes(
      failedFile?.length > 0 ? 207 : 200,
      { failedFile },
      null,
      "Files Deleted"
    );

    return res.status(response?.status).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const ReStock = async (req, res) => {
  try {
    const _id = req?.params?.id;
    const { stock } = req?.body;

    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(
        400,
        null,
        new Error("Invalid ID"),
        "Please provide valid ID"
      );
      return res.status(400).json(response);
    }

    const filters = { _id };

    // Add vendor check if vendor is making the request
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const data = await Shop.findOneAndUpdate(filters, { $set: { stock } });
    if (!data) {
      return res.status(404).json(GenRes(404, null, null, "Product not found"));
    }

    return res.status(200).json(GenRes(200, data, null, "Updated stock"));
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = {
  ListShop,
  AddShop,
  DeleteShop,
  AddToCart,
  RemoveFromCart,
  GetCart,
  MultipleFiles,
  DeleteFiles,
  SingleShop,
  ReStock,
};
