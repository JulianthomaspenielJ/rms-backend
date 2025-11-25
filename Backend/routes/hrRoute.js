const express = require('express');
const router = express.Router();

const { inviteHR, setHRPassword, listHR } = require('../controllers/Hr/hrController');
const { getCandidatesByJD } = require('../controllers/Hr/listCandidateController');
const { scheduleInterview } = require('../controllers/Hr/scheduleController');
const { 
  getDashboardStats, 
  getApplicationsOverTime, 
  getApplicationsByDepartment, 
  getApplicationSources, 
  getOpenPositions 
} = require('../controllers/Hr/dashboardController');

// POST /api/hr/invite
router.post('/invite', inviteHR);

// POST /api/hr/set-password
router.post('/set-password', setHRPassword);

// GET /api/hr/list - Only company admin can access
router.get('/list', listHR);

// POST /api/hr/candidates - Get candidates for a specific JD
router.post('/candidates', express.json(), getCandidatesByJD);

// POST /api/hr/schedule-interview - Schedule interviews and create candidate credentials
router.post('/schedule-interview', express.json(), scheduleInterview);

// GET /api/hr/dashboard/stats
router.get('/dashboard/stats', getDashboardStats);

// GET /api/hr/dashboard/applications-over-time
router.get('/dashboard/applications-over-time', getApplicationsOverTime);

// GET /api/hr/dashboard/applications-by-department
router.get('/dashboard/applications-by-department', getApplicationsByDepartment);

// GET /api/hr/dashboard/application-sources
router.get('/dashboard/application-sources', getApplicationSources);

// GET /api/hr/dashboard/open-positions
router.get('/dashboard/open-positions', getOpenPositions);

module.exports = router;

