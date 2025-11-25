const express = require('express');
const router = express.Router();

const { uploadJobDescription, closeJobDescription, jdList, uploadBulkResumes, verifyHRToken } = require('../../controllers/Hr/uploadController');

// POST /upload-job-description - Upload job description PDF
router.post('/upload-job-description', verifyHRToken, uploadJobDescription);

// PUT /close-job-description - Close job description (set status to 0)
router.put('/close-job-description', verifyHRToken, closeJobDescription);

// GET /jd-list - List job descriptions for the authenticated HR user
router.get('/jd-list', verifyHRToken, jdList);

// POST /upload-bulk-resumes - Upload multiple resumes for a job description
router.post('/upload-bulk-resumes', verifyHRToken, uploadBulkResumes);

module.exports = router;

