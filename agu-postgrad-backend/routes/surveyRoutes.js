const express = require('express');
const router = express.Router();
const surveyController = require('../controllers/surveyController');
const { verifyToken, requireRoles } = require('../middlewares/authMiddleware');

router.get('/active', surveyController.getActiveSurveys);
router.get('/:campaignId/questions', surveyController.getSurveyQuestions);
router.post('/submit', surveyController.submitSurveyResponse);
router.get('/statistics/:campaignId', verifyToken, requireRoles('ADMIN'), surveyController.getSurveyStatistics);

module.exports = router;

