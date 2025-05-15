const basicMiddleware = require('../../middlewares/basicMiddleware');
const router = require('express').Router();
const { SearchUserByNameOrEmail } = require('./search.methods.js');

router.get('/user/search',basicMiddleware, SearchUserByNameOrEmail);

module.exports = router;