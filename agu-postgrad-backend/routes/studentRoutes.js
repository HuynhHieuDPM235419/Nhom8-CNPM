const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { verifyToken, requireRoles } = require('../middlewares/authMiddleware');

router.get('/me', verifyToken, studentController.getMyInfo);
router.get('/tuition', verifyToken, studentController.getTuition);
router.post('/tuition/pay', verifyToken, studentController.payTuition);
router.post('/register-course', verifyToken, requireRoles('STUDENT'), studentController.registerCourse);
router.get('/schedule', verifyToken, studentController.getMyCourses);
router.get('/grades', verifyToken, studentController.getMyGrades);
router.put('/enter-grades', verifyToken, requireRoles('LECTURER', 'ADMIN'), studentController.enterGrades);

module.exports = router;

