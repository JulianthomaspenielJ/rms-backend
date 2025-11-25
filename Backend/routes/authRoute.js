const express = require('express');
const router = express.Router();

const { registerCompany, sendVerificationOTP, verifyOTP, registerCandidate, login, renewSession, logout, resetPassword, forgotPassword, confirmForgotPassword } = require('../controllers/authController');

router.post('/register-company', registerCompany);
router.post('/register-candidate', registerCandidate);
router.post('/resend-otp', sendVerificationOTP); // Used to resend the verification code if needed
router.post('/verify-otp', verifyOTP);
router.post('/login', login);
router.post('/renew-session', renewSession);
router.post('/logout', logout);
router.post('/reset-password', resetPassword);
router.post('/forgot-password', forgotPassword);
router.post('/confirm-forgot-password', confirmForgotPassword);

module.exports = router;


