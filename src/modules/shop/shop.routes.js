const router = require("express").Router();
const { vendorMiddleware } = require("../../middlewares/vendorMiddleware");
const basicMiddleware = require("../../middlewares/basicMiddleware");
const ShopFile = require("../../utils/fileProcessor/multer.shop");
const {
  ListShop,
  AddShop,
  UpdateProduct,
  GetCart,
  AddToCart,
  RemoveFromCart,
  DeleteFiles,
  SingleShop,
  ReStock,
  DeleteProduct,
} = require("./shop.methods");
const {
  AddCategory,
  GetCategories,
  DeleteCategory,
  UpdateCategory,
} = require("./category.methods");

// Category routes for vendors
router.post("/vendor-add-category", vendorMiddleware, AddCategory);
router.get("/vendor-categories", vendorMiddleware, GetCategories);
router.put("/vendor-update-category/:id", vendorMiddleware, UpdateCategory);
router.delete("/vendor-delete-category/:id", vendorMiddleware, DeleteCategory);

// Public shop routes
router.get("/list-shops/:page", basicMiddleware, ListShop);
router.get("/get-shop/:id", basicMiddleware, SingleShop);

// Vendor shop management routes
router.get("/vendor-list-shops/:page", vendorMiddleware, ListShop);
router.get("/vendor-get-shop/:id", vendorMiddleware, SingleShop);
router.post(
  "/vendor-add-shop",
  vendorMiddleware,
  ShopFile.array("images"),
  AddShop
);
router.put(
  "/vendor-products/:id",
  vendorMiddleware,
  ShopFile.array("images"),
  UpdateProduct
);
router.patch("/vendor-products/:id/stock", vendorMiddleware, ReStock);
router.delete("/vendor-products/:id", vendorMiddleware, DeleteProduct);
router.delete("/vendor-files", vendorMiddleware, DeleteFiles);

// Cart management routes
router.get("/list-carts", basicMiddleware, GetCart);
router.post("/add-to-cart", basicMiddleware, AddToCart);
router.delete("/delete-cart/:id", basicMiddleware, RemoveFromCart);

module.exports = router;
