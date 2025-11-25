const express = require('express');
const router = express.Router();

const { 
  getDashboardOverview, 
  getUserTrends, 
  getMembersOverview,
  getCandidateList,
  getRecruiterList,
  getRecentFeedbacks
} = require('../controllers/superAdmin/dashboardController');

// Dashboard routes - Super Admin only

// GET /api/dashboard/overview - Get dashboard overview statistics
router.get('/overview', getDashboardOverview);

// GET /api/dashboard/user-trends - Get user registration trends
router.get('/user-trends', getUserTrends);

// GET /api/dashboard/members-overview - Get members overview with trends
router.get('/members-overview', getMembersOverview);

// GET /api/dashboard/candidates - Get paginated list of candidates (10 per page)
router.get('/candidates', getCandidateList);

// GET /api/dashboard/recruiters - Get paginated list of recruiters (10 per page)
router.get('/recruiters', getRecruiterList);

// GET /api/dashboard/recent-feedbacks - Get recent 10 feedbacks
router.get('/recent-feedbacks', getRecentFeedbacks);


module.exports = router;
