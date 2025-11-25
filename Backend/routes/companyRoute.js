const express = require('express');
const router = express.Router();
const {
  createCompany,
  getCompanyById,
  updateCompany,
  deleteCompany,
  searchCompanies
} = require('../controllers/companyController');
const {
  getSummary,
  getGraphs,
  getDashboard
} = require('../controllers/companyAnalyticsController');

// Company management routes
router.post('/', createCompany);
router.get('/search', searchCompanies);
router.get('/:id', getCompanyById);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);

// Company analytics routes
router.get('/analytics/summary', getSummary);
router.get('/analytics/graphs', getGraphs);
router.get('/analytics/dashboard', getDashboard);

module.exports = router;
