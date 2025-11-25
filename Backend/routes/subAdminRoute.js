const express = require('express');
const router = express.Router();

const { inviteSubAdmin, setSubAdminPassword } = require('../controllers/subAdmin/subAdminController');

// POST /api/subadmin/invite
router.post('/invite', inviteSubAdmin);

// POST /api/subadmin/set-password
router.post('/set-password', setSubAdminPassword);

module.exports = router;
