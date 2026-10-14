const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/login', authController.login);
router.get('/profile', verifyToken, authController.getProfile);
router.put('/change-password', verifyToken, authController.changePassword);
router.get('/notifications', verifyToken, authController.getNotifications);
router.put('/notifications/:id/read', verifyToken, authController.markNotificationRead);

module.exports = router;

