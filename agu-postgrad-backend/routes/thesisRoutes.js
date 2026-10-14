const express = require('express');
const router = express.Router();
const thesisController = require('../controllers/thesisController');
const upload = require('../middlewares/uploadMiddleware');
const { verifyToken, requireRoles } = require('../middlewares/authMiddleware');

// Đăng ký và Quota GVHD
router.post('/register-advisor', verifyToken, requireRoles('STUDENT'), thesisController.registerAdvisor);
router.get('/faculty/advising-requests', verifyToken, requireRoles('LECTURER', 'ADMIN'), thesisController.getFacultyAdvisingRequests);
router.put('/faculty/advising-requests/:id', verifyToken, requireRoles('LECTURER', 'ADMIN'), thesisController.respondAdvisingRequest);

// Đề tài & Tiến độ
router.post('/register-topic', verifyToken, requireRoles('STUDENT'), thesisController.registerThesisTopic);
router.get('/my-progress', verifyToken, thesisController.getMyThesisProgress);

// Nộp tài liệu & Báo cáo mốc (≤ 25MB)
router.post('/submit-report', verifyToken, requireRoles('STUDENT'), upload.single('report_file'), thesisController.submitThesisReport);
router.post('/submit-turnitin', verifyToken, requireRoles('STUDENT'), upload.single('turnitin_file'), thesisController.submitTurnitin);
router.post('/submit-publication', verifyToken, requireRoles('STUDENT'), upload.single('evidence_file'), thesisController.submitPublication);
router.post('/submit-certificate', verifyToken, requireRoles('STUDENT'), upload.single('certificate_file'), thesisController.submitLanguageCertificate);

// Giảng viên đánh giá
router.put('/evaluate-submission/:id', verifyToken, requireRoles('LECTURER', 'ADMIN'), thesisController.evaluateSubmission);

module.exports = router;

