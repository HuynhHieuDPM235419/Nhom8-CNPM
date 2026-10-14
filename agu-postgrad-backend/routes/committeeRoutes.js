const express = require('express');
const router = express.Router();
const committeeController = require('../controllers/committeeController');
const { verifyToken, requireRoles } = require('../middlewares/authMiddleware');

// Gatekeeper kiểm tra điều kiện bảo vệ
router.get('/gatekeeper-check', verifyToken, committeeController.checkDefenseGatekeeper);
router.get('/gatekeeper-check/:studentId', verifyToken, committeeController.checkDefenseGatekeeper);

// Hội đồng bảo vệ & Lịch
router.post('/create', verifyToken, requireRoles('ADMIN'), committeeController.createCommittee);
router.post('/schedule', verifyToken, requireRoles('ADMIN'), committeeController.scheduleDefense);
router.get('/schedules', verifyToken, committeeController.getDefenseSchedules);

// Chấm điểm
router.post('/evaluate', verifyToken, requireRoles('LECTURER', 'ADMIN'), committeeController.evaluateDefense);
router.post('/calculate-grade/:scheduleId', verifyToken, requireRoles('ADMIN'), committeeController.triggerCalculateGrade);

module.exports = router;

