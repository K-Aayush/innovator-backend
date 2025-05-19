const router = require("express").Router();
const { vendorMiddleware } = require("../../middlewares/vendorMiddleware");
const basicMiddleware = require("../../middlewares/basicMiddleware");
const ShopFile = require("../../utils/fileProcessor/multer.shop");
const {
  ListShop,
  AddShop,
  DeleteShop,
  GetCart,
  AddToCart,
  RemoveFromCart,
  MultipleFiles,
  SingleShop,
  ReStock,
} = require("./shop.methods");
const {
  AddCategory,
  GetCategories,
  DeleteCategory,
} = require("./category.methods");

// Category routes for vendors
router.post("/vendor-add-category", vendorMiddleware, AddCategory);
router.get("/vendor-categories", vendorMiddleware, GetCategories);
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
router.post("/vendor-update-shop/:id", vendorMiddleware, ReStock);
router.delete("/vendor-delete-shop/:id", vendorMiddleware, DeleteShop);
router.post(
  "/vendor-upload-shop-images",
  vendorMiddleware,
  ShopFile.any(),
  MultipleFiles
);

// Cart management routes
router.get("/list-carts", basicMiddleware, GetCart);
router.post("/add-to-cart", basicMiddleware, AddToCart);
router.delete("/delete-cart/:id", basicMiddleware, RemoveFromCart);

module.exports = router;
