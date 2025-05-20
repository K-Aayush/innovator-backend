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

    if (!req.vendor) {
      return res
        .status(401)
        .json(
          GenRes(401, null, null, "Unauthorized: Vendor not authenticated")
        );
    }

    const filters = {
      "vendor._id": req.vendor._id,
      category: { $exists: true, $ne: null },
      "category._id": { $exists: true, $ne: "" },
      "category.name": { $exists: true, $ne: "" },
    };

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

    const validProducts = recentProducts.filter(
      (product) =>
        product.category && product.category._id && product.category.name
    );

    if (validProducts.length < recentProducts.length) {
      console.warn(
        "Filtered out invalid products:",
        recentProducts.filter(
          (product) =>
            !product.category || !product.category._id || !product.category.name
        )
      );
    }

    if (validProducts.length === 0 && page === 0) {
      console.log("No products found for vendor:", req.vendor._id);
    }

    const mixedProduct = shuffleArray(validProducts);
    const response = GenRes(
      200,
      mixedProduct,
      null,
      "Responding shuffled & paginated content"
    );
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error in ListShop:", {
      message: error.message,
      stack: error.stack,
      vendorId: req.vendor?._id,
      query: req.query,
      page: req.params.page,
    });
    const response = GenRes(500, null, error, "Failed to fetch products");
    return res.status(500).json(response);
  }
};

const SingleShop = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(400, null, null, "Missing or invalid product id");
      return res.status(400).json(response);
    }

    const filters = { _id };
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
    console.error("Error in SingleShop:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const AddShop = async (req, res) => {
  try {
    console.log("req.body:", req.body);
    console.log("req.file_locations:", req.file_locations);
    console.log("req.vendor:", req.vendor);
    console.log("data.categoryId:", req.body.categoryId);

    const data = req.body;
    const fileLocations = req.file_locations || [];

    if (!data) {
      return res.status(400).json(GenRes(400, null, null, "Missing data"));
    }

    if (!data.categoryId) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Category is required"));
    }

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

    if (fileLocations.length === 0) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "At least one image is required"));
    }

    const shopData = {
      name: data.name,
      description: data.description,
      price: Number(data.price),
      stock: Number(data.stock),
      content: data.content,
      images: fileLocations,
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
    console.log("Saved shop images:", newShop.images); // Debug
    return res.status(201).json(GenRes(201, newShop, null, "New shop added"));
  } catch (error) {
    console.error("Error in AddShop:", error);
    if (req.file_locations?.length > 0) {
      for (const file of req.file_locations) {
        try {
          fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
        } catch (cleanupError) {
          console.log(
            `Failed to clean up file ${file}:`,
            cleanupError?.message
          );
        }
      }
    }
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const AddToCart = async (req, res) => {
  try {
    const data = req?.body;
    const user = req?.user;

    const updated = await Cart.findOneAndUpdate(
      { product: data?.product, email: user?.email },
      { $set: { ...data, email: user?.email } },
      { new: true, upsert: true }
    );

    const response = GenRes(200, updated, null, "Added to cart");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error in AddToCart:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const RemoveFromCart = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id || !isValidObjectId(_id)) {
      return res.status(400).json(GenRes(400, null, null, "Invalid cart ID"));
    }
    const user = req?.user;
    const cart = await Cart.findOneAndDelete(
      { _id, email: user?.email },
      { new: true }
    );
    if (!cart) {
      return res
        .status(404)
        .json(GenRes(404, null, null, "Cart item not found"));
    }
    const response = GenRes(200, cart, null, "Removed from cart");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error in RemoveFromCart:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const GetCart = async (req, res) => {
  try {
    const email = req?.user?.email;
    const data = await Cart.find({ email }).populate("product");
    const response = GenRes(200, data, null, "Cart retrieved successfully");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error in GetCart:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const UpdateProduct = async (req, res) => {
  try {
    const _id = req?.params?.id;
    const data = req?.body;
    const fileLocations = req?.file_locations || [];

    if (!_id || !isValidObjectId(_id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, new Error("Invalid ID"), "Please provide valid ID")
        );
    }

    if (!data.name || !data.description || !data.price || !data.stock) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            new Error("Missing required fields"),
            "Please provide all required fields"
          )
        );
    }

    const filters = { _id };
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const product = await Shop.findOne(filters);
    if (!product) {
      return res.status(404).json(GenRes(404, null, null, "Product not found"));
    }

    if (data.categoryId) {
      if (!isValidObjectId(data.categoryId)) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              new Error("Invalid category ID"),
              "Please provide a valid category ID"
            )
          );
      }

      const category = await Category.findOne({
        _id: data.categoryId,
        "vendor._id": req.vendor._id,
      });

      if (!category) {
        return res
          .status(404)
          .json(
            GenRes(
              404,
              null,
              { error: "Category not found" },
              "Invalid category"
            )
          );
      }

      product.category = {
        _id: category._id.toString(),
        name: category.name,
      };
    }

    product.name = data.name;
    product.description = data.description;
    product.price = Number(data.price);
    product.stock = Number(data.stock);
    product.content = data.content || product.content;

    if (fileLocations.length > 0) {
      if (product.images && product.images.length > 0) {
        const failedFiles = [];
        for (const oldImage of product.images) {
          try {
            fs.unlinkSync(path.join(process.cwd(), oldImage.slice(1)));
          } catch (error) {
            console.log(`Failed to delete image ${oldImage}:`, error?.message);
            failedFiles.push(oldImage);
          }
        }
        if (failedFiles.length > 0) {
          console.log("Some old images failed to delete:", failedFiles);
        }
      }

      product.images = fileLocations;
    }

    await product.save();
    console.log("Updated product images:", product.images); // Debug
    return res
      .status(200)
      .json(GenRes(200, product, null, "Product updated successfully"));
  } catch (error) {
    console.error("Error in UpdateProduct:", error);
    if (req?.file_locations?.length > 0) {
      for (const file of req.file_locations) {
        try {
          fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
        } catch (cleanupError) {
          console.log(
            `Failed to clean up file ${file}:`,
            cleanupError?.message
          );
        }
      }
    }
    return res.status(500).json(GenRes(500, null, error, error?.message));
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
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const data = await Shop.findOneAndUpdate(
      filters,
      { $set: { stock } },
      { new: true }
    );
    if (!data) {
      return res.status(404).json(GenRes(404, null, null, "Product not found"));
    }

    return res.status(200).json(GenRes(200, data, null, "Updated stock"));
  } catch (error) {
    console.error("Error in ReStock:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const DeleteProduct = async (req, res) => {
  try {
    const _id = req?.params?.id;

    // Validate product ID
    if (!_id || !isValidObjectId(_id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, new Error("Invalid ID"), "Please provide valid ID")
        );
    }

    // Find the product with vendor check
    const filters = { _id };
    if (req.vendor) {
      filters["vendor._id"] = req.vendor._id;
    }

    const product = await Shop.findOne(filters);
    if (!product) {
      return res.status(404).json(GenRes(404, null, null, "Product not found"));
    }

    // Delete associated images
    if (product.images && product.images.length > 0) {
      const failedFiles = [];
      for (const image of product.images) {
        try {
          fs.unlinkSync(path.join(process.cwd(), image.slice(1)));
        } catch (error) {
          console.log(`Failed to delete image ${image}:`, error?.message);
          failedFiles.push(image);
        }
      }
      if (failedFiles.length > 0) {
        console.log("Some images failed to delete:", failedFiles);
      }
    }

    // Delete the product
    await Shop.deleteOne({ _id });

    return res
      .status(200)
      .json(GenRes(200, null, null, "Product deleted successfully"));
  } catch (error) {
    console.error("Error in DeleteProduct:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
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
        console.log(`Failed to delete file ${file}:`, error?.message);
        failedFile.push(file);
      }
    }

    const response = GenRes(
      failedFile?.length > 0 ? 207 : 200,
      { failedFile },
      null,
      "Files deleted"
    );
    return res.status(response?.status).json(response);
  } catch (error) {
    console.error("Error in DeleteFiles:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = {
  ListShop,
  AddShop,
  AddToCart,
  RemoveFromCart,
  GetCart,
  UpdateProduct,
  DeleteFiles,
  SingleShop,
  ReStock,
  DeleteProduct,
};
