const express = require('express');
const router = express.Router();

const { companyList, changeCompanyStatus, getCompaniesByStatus, subAdminList, changeSubAdminStatus, getSubAdminByStatus } = require('../controllers/superAdmin/superAdminController');

// Company management routes
// GET /api/superadmin/company-list
router.get('/company-list', companyList);

// GET /api/superadmin/companies/status/:status
router.get('/company/status/:status', getCompaniesByStatus);

// GET /api/superadmin/subadmin-list
router.get('/subadmin-list', subAdminList);

// PATCH /api/superadmin/subadmin/status
router.put('/subadmin/status', changeSubAdminStatus);

// GET /api/superadmin/subadmins/status/:status
router.get('/subadmin/status/:status', getSubAdminByStatus);

// PATCH /api/superadmin/company/status
router.put('/company/status', changeCompanyStatus);

module.exports = router;
