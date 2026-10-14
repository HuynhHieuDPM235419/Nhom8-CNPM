const express = require('express');
const router = express.Router();
const academicController = require('../controllers/academicController');

router.get('/majors', academicController.getMajors);
router.get('/curriculums', academicController.getCurriculums);
router.get('/curriculums/:id/courses', academicController.getCurriculumCourses);
router.get('/lecturers', academicController.getLecturers);
router.get('/semesters', academicController.getSemesters);
router.get('/classes', academicController.getClasses);

module.exports = router;

