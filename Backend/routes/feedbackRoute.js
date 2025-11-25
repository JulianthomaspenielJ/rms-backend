const express = require('express');
const router = express.Router();

const { createFeedback, feedbackList } = require('../controllers/feedbackController');

// Feedback routes
// POST /api/feedback/create
router.post('/create', createFeedback);

// GET /api/feedback/list - Only super admin can access
router.get('/list', feedbackList);

module.exports = router;
