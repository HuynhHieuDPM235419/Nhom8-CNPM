const express = require('express');
const router = express.Router();
const admissionController = require('../controllers/admissionController');
const upload = require('../middlewares/uploadMiddleware');
const { verifyToken, requireRoles } = require('../middlewares/authMiddleware');

// Public endpoints (Dành cho thí sinh nộp hồ sơ & tra cứu)
router.get('/campaigns', admissionController.getCampaigns);
router.post('/register', upload.single('degree_file'), admissionController.registerProfile);
router.get('/lookup', admissionController.lookupAdmission);

// Admin endpoints (Dành cho Phòng Đào tạo SĐH)
router.get('/profiles', verifyToken, requireRoles('ADMIN'), admissionController.getAllProfiles);
router.put('/profiles/:id/review', verifyToken, requireRoles('ADMIN'), admissionController.reviewProfile);
router.post('/profiles/:id/admit', verifyToken, requireRoles('ADMIN'), admissionController.admitCandidate);

module.exports = router;

